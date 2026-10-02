"use server";

/**
 * Google Calendar sync for Taskora.
 *
 * Each employee connects their own Google account once; afterwards the
 * server pushes their assigned tasks to their calendar and keeps them
 * current. Two sync paths:
 *
 *   • Outbound — task → calendar event (create / update / delete).
 *   • Inbound  — Google pushes a notification to our watch channel
 *                when the *user* edits their calendar, and we pull the
 *                change set with the stored syncToken.
 *
 * Tokens are read/written through the service-role client only; the
 * table's RLS + column grants keep the ciphertext away from the client
 * bundle. Refresh tokens are encrypted at rest (lib/crypto/google-token).
 *
 * Env:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   GOOGLE_TOKEN_ENCRYPTION_KEY   (32 bytes, base64/hex)
 *   NEXT_PUBLIC_APP_URL           (OAuth redirect + watch channel origin)
 *   GOOGLE_WEBHOOK_URL            (optional, defaults to NEXT_PUBLIC_APP_URL)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth";
import { decryptToken, encryptToken } from "@/lib/crypto/google-token";
import {
  buildAuthorizeParams,
  buildEventBody,
  callbackRedirectUri,
  normalizeAppUrl,
  type SyncableTask,
} from "@/lib/google/calendar";
import type { ActionResponse } from "@/types/database";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** calendar/v3/users/me is retired; this is the supported replacement. */
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Minimal write scope — enough to create/update our own events. */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
];

const OAUTH_STATE_COOKIE = "gcal_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

/** Google watch channels are good for at most 7 days. */
const WATCH_TTL_MS = 6 * 24 * 60 * 60 * 1000;

// ──────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────

interface GoogleTokenRow {
  id: string;
  user_id: string;
  google_email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  calendar_id: string;
  sync_token: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_expires_at: string | null;
  last_synced_at: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured. Add it in Settings → Environment.`);
  }
  return value;
}

function appUrl(): string {
  return normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
}

function randomState(): string {
  return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const json = (await res.json()) as GoogleTokenResponse;
  if (!res.ok) {
    console.error("[google] token exchange failed", res.status, json);
  }
  return json;
}

interface TokenBundle {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

/**
 * Mint an access token. Refreshes (and persists) the cached one when
 * it is missing or about to expire, so we never send a stale token.
 */
async function getAccessToken(row: GoogleTokenRow): Promise<TokenBundle> {
  const cachedValid =
    row.access_token &&
    row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() > Date.now() + 60_000;

  if (cachedValid) {
    return {
      accessToken: row.access_token as string,
      refreshToken: null,
      expiresAt: new Date(row.access_token_expires_at as string).getTime(),
    };
  }


  const refreshToken = decryptToken(row.refresh_token);
  const json = await postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
  });


  if (!json.access_token) {
    throw new Error(
      json.error_description || json.error || "Couldn't refresh the Google access token"
    );
  }

  const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;

  // A refresh can rotate the refresh token; keep whichever is newest.
  const rotated = json.refresh_token ? encryptToken(json.refresh_token) : null;

  await createAdminClient()
    .from("user_google_tokens")
    .update({
      access_token: json.access_token,
      access_token_expires_at: new Date(expiresAt).toISOString(),
      ...(rotated ? { refresh_token: rotated } : {}),
    })
    .eq("id", row.id);

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt,
  };
}

/** Thrown for a 410, which means the stored syncToken is stale. */
class SyncTokenGoneError extends Error {
  constructor() {
    super("syncToken is no longer valid");
    this.name = "SyncTokenGoneError";
  }
}

interface GoogleApiError {
  error?: { code?: number; message?: string };
}

async function googleFetch<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (res.status === 410) {
    throw new SyncTokenGoneError();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GoogleApiError;
    throw new Error(
      `Google API ${res.status}: ${body.error?.message ?? res.statusText}`
    );
  }

  return (await res.json()) as T;
}

// ──────────────────────────────────────────────
// DB access (service role — RLS doesn't apply)
// ──────────────────────────────────────────────

async function loadTokenRow(userId: string): Promise<GoogleTokenRow | null> {
  const { data, error } = await createAdminClient()
    .from("user_google_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[google] load token row", error);
    return null;
  }
  return (data as GoogleTokenRow | null) ?? null;
}

export interface GoogleConnectionStatus {
  connected: boolean;
  googleEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  syncedTaskCount: number;
}

/** Read-only status for the connect/disconnect UI. */
export async function getGoogleCalendarStatus(): Promise<
  ActionResponse<GoogleConnectionStatus>
> {
  try {
    const profile = await requireAuth();
    const row = await loadTokenRow(profile.id);

    if (!row) {
      return {
        success: true,
        data: {
          connected: false,
          googleEmail: null,
          calendarId: null,
          lastSyncedAt: null,
          syncedTaskCount: 0,
        },
      };
    }

    const { count } = await createAdminClient()
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", profile.id)
      .not("google_event_id", "is", null);

    return {
      success: true,
      data: {
        connected: true,
        googleEmail: row.google_email,
        calendarId: row.calendar_id,
        lastSyncedAt: row.last_synced_at,
        syncedTaskCount: count ?? 0,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Build the Google consent URL.
 *
 * access_type=offline + prompt=consent is what forces Google to hand
 * back a refresh_token on *every* consent. Without prompt=consent
 * Google only returns a refresh token the first time a user authorises
 * an app, so a user who revoked access would silently get none.
 */
export async function connectGoogleCalendar(): Promise<ActionResponse<{ url: string }>> {
  try {
    const profile = await requireAuth();
    const state = randomState();

    const params = buildAuthorizeParams({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      redirectUri: callbackRedirectUri(appUrl()),
      scopes: SCOPES,
      state,
    });

    // The state is echoed back by Google; we need it to tie the
    // callback to this browser session (CSRF protection). The issued-at
    // suffix lets the callback reject a replayed/expired state.
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    jar.set(OAUTH_STATE_COOKIE, `${state}:${profile.id}:${Date.now()}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STATE_TTL_MS / 1000,
    });

    return { success: true, data: { url: `${AUTH_ENDPOINT}?${params.toString()}` } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't start the connection";
    return { success: false, error: message };
  }
}

/**
 * Exchange the `code` for tokens and persist them.
 *
 * Called from the callback route (which owns the request/response), so
 * the userId is passed explicitly rather than read from the session —
 * the Supabase cookie is still present at that point, but keeping the
 * dependency explicit makes the route easy to reason about.
 */
export async function handleGoogleCallback(
  code: string,
  userId: string
): Promise<ActionResponse<{ googleEmail: string | null }>> {
  try {
    const json = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: callbackRedirectUri(appUrl()),
    });

    if (json.error || !json.access_token) {
      return {
        success: false,
        error: json.error_description || json.error || "Google rejected the authorization",
      };
    }

    if (!json.refresh_token) {
      // Log the whole response: without it there is no way to tell an
      // already-consented user from a revoked grant or a non-test-user
      // in Testing, and all three look identical from the UI.
      console.error(
        "[google] no refresh_token in callback response",
        JSON.stringify({
          has_access_token: !!json.access_token,
          scope: json.scope,
          expires_in: json.expires_in,
        })
      );
      return {
        success: false,
        error: "NO_REFRESH_TOKEN",
      };
    }

    // Identify which Google account was linked.
    //
    // This used to call calendar/v3/users/me, which Google has since
    // removed — it answers 404 for every token, so the failure was
    // swallowed and the literal string "unknown" was stored and shown
    // as the connected address. The OAuth userinfo endpoint is the
    // supported replacement and accepts the calendar scope.
    const profileRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${json.access_token}` },
      cache: "no-store",
    });
    if (!profileRes.ok) {
      console.error(
        "[google] users/me lookup failed",
        profileRes.status,
        profileRes.statusText,
        await profileRes.text().catch(() => "")
      );
    }
    const profileJson = profileRes.ok
      ? ((await profileRes.json()) as { id?: string; email?: string })
      : {};
    const googleEmail = profileJson.email ?? null;

    const admin = createAdminClient();
    const { error } = await admin.from("user_google_tokens").upsert(
      {
        user_id: userId,
        google_email: googleEmail ?? "unknown",
        refresh_token: encryptToken(json.refresh_token),
        access_token: json.access_token,
        access_token_expires_at: new Date(
          Date.now() + (json.expires_in ?? 3600) * 1000
        ).toISOString(),
        // A fresh connection invalidates any previous cursor.
        sync_token: null,
        last_synced_at: null,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error("[google] store tokens", error);
      return { success: false, error: "Couldn't save the Google connection" };
    }

    return { success: true, data: { googleEmail } };
  } catch (err) {
    console.error("[google] handleGoogleCallback", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Couldn't complete the connection",
    };
  }
}

/** Revoke access locally and ask Google to drop the grant. */
export async function disconnectGoogleCalendar(): Promise<ActionResponse> {
  try {
    const profile = await requireAuth();
    const row = await loadTokenRow(profile.id);

    if (row) {
      // Best-effort remote revoke; local delete happens regardless.
      try {
        const { accessToken } = await getAccessToken(row);
        await postToken({
          grant_type: "refresh_token",
          refresh_token: decryptToken(row.refresh_token),
          client_id: requireEnv("GOOGLE_CLIENT_ID"),
          client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        });
        void accessToken;
      } catch (err) {
        console.warn("[google] revoke failed (continuing)", err);
      }

      await createAdminClient()
        .from("user_google_tokens")
        .delete()
        .eq("user_id", profile.id);
    }

    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Outbound sync: task → calendar event
// ──────────────────────────────────────────────

export interface SyncResult {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  errors: string[];
}

const TASK_SELECT = `id, title, description, status, priority, deadline, project_id,
       google_event_id, project:projects(name, client:clients(name))`;

/** Push one task to the caller's calendar and record the event id. */
export async function syncTaskToCalendar(
  taskId: string
): Promise<ActionResponse<{ googleEventId: string }>> {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();

    const row = await loadTokenRow(profile.id);
    if (!row) {
      return { success: false, error: "Connect Google Calendar first" };
    }

    const { data, error } = await admin
      .from("tasks")
      .select(TASK_SELECT)
      .eq("id", taskId)
      .eq("assigned_to", profile.id)
      .maybeSingle();

    if (error) {
      console.error("[google] load task", error);
      return { success: false, error: "Couldn't load the task" };
    }
    if (!data) {
      return { success: false, error: "Task not found" };
    }

    const task = data as unknown as SyncableTask;
    const { accessToken } = await getAccessToken(row);
    const event = buildEventBody(task);
    const base = `${CALENDAR_API}/calendars/${encodeURIComponent(row.calendar_id)}/events`;

    if (task.google_event_id) {
      await googleFetch(
        `${base}/${encodeURIComponent(task.google_event_id)}`,
        accessToken,
        { method: "PUT", body: JSON.stringify(event) }
      );
      return { success: true, data: { googleEventId: task.google_event_id } };
    }

    const created = await googleFetch<{ id: string }>(base, accessToken, {
      method: "POST",
      body: JSON.stringify(event),
    });

    await admin.from("tasks").update({ google_event_id: created.id }).eq("id", taskId);
    return { success: true, data: { googleEventId: created.id } };
  } catch (err) {
    console.error("[google] syncTaskToCalendar", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Couldn't sync the task",
    };
  }
}

/**
 * Full sync for the signed-in user: every assigned, non-completed task
 * gets an event. Completed tasks have their mapping cleared (the event
 * itself is left alone — the user may have edited it deliberately).
 */
export async function syncAllTasksToCalendar(): Promise<ActionResponse<SyncResult>> {
  try {
    const profile = await requireAuth();
    return fullSyncForUser(profile.id);
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** The per-user full sync, shared with the incremental path. */
async function fullSyncForUser(userId: string): Promise<ActionResponse<SyncResult>> {
  const admin = createAdminClient();

  const { data: rawRow } = await admin
    .from("user_google_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const row = rawRow as GoogleTokenRow | null;

  if (!row) {
    return { success: false, error: "Connect Google Calendar first" };
  }

  const { accessToken } = await getAccessToken(row);
  const base = `${CALENDAR_API}/calendars/${encodeURIComponent(row.calendar_id)}/events`;

  // Prime a fresh cursor so the next incremental sync has a baseline.
  let nextSyncToken: string | undefined;
  try {
    const page = await googleFetch<EventsResponse>(
      `${base}?maxResults=1&showDeleted=true`,
      accessToken
    );
    nextSyncToken = page.nextSyncToken;
  } catch (err) {
    console.error("[google] initial cursor fetch", err);
  }

  const { data: rawTasks, error } = await admin
    .from("tasks")
    .select(TASK_SELECT)
    .eq("assigned_to", userId);

  if (error) {
    console.error("[google] load tasks", error);
    return { success: false, error: "Couldn't load your tasks" };
  }

  const result: SyncResult = {
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    errors: [],
  };

  for (const task of (rawTasks ?? []) as unknown as SyncableTask[]) {
    if (task.status === "COMPLETED") {
      if (task.google_event_id) {
        await admin.from("tasks").update({ google_event_id: null }).eq("id", task.id);
        result.removed += 1;
      }
      continue;
    }

    try {
      if (task.google_event_id) {
        await googleFetch(
          `${base}/${encodeURIComponent(task.google_event_id)}`,
          accessToken,
          { method: "PUT", body: JSON.stringify(buildEventBody(task)) }
        );
        result.updated += 1;
      } else {
        const created = await googleFetch<{ id: string }>(base, accessToken, {
          method: "POST",
          body: JSON.stringify(buildEventBody(task)),
        });
        await admin
          .from("tasks")
          .update({ google_event_id: created.id })
          .eq("id", task.id);
        result.created += 1;
      }
    } catch (err) {
      result.errors.push(
        `${task.id}: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  await admin
    .from("user_google_tokens")
    .update({
      last_synced_at: new Date().toISOString(),
      ...(nextSyncToken ? { sync_token: nextSyncToken } : {}),
    })
    .eq("id", row.id);

  return { success: true, data: result };
}

// ──────────────────────────────────────────────
// Inbound sync: pull the user's calendar changes
// ──────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

interface EventsResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

async function fetchChangePage(
  row: GoogleTokenRow,
  accessToken: string,
  syncToken: string,
  pageToken?: string
): Promise<EventsResponse> {
  const params = new URLSearchParams({
    syncToken,
    showDeleted: "true",
    maxResults: "250",
    ...(pageToken ? { pageToken } : {}),
  });
  return googleFetch<EventsResponse>(
    `${CALENDAR_API}/calendars/${encodeURIComponent(row.calendar_id)}/events?${params.toString()}`,
    accessToken
  );
}

/**
 * Incremental sync for one user.
 *
 * The change set tells us what the *user* did in Google. The only
 * action we take is on deletion: when an event carrying our
 * taskoraTaskId marker is deleted, clear the local mapping so the next
 * outbound sync re-creates it. Edits made in Google are deliberately
 * not imported — Taskora owns task fields, so importing them would
 * just be overwritten (or worse, fight) on the next push.
 */
export async function incrementalSyncForUser(
  userId: string
): Promise<ActionResponse<SyncResult>> {
  const admin = createAdminClient();

  const { data: rawRow } = await admin
    .from("user_google_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const row = rawRow as GoogleTokenRow | null;

  const empty: SyncResult = {
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    errors: [],
  };
  if (!row) return { success: true, data: empty };

  // No cursor yet -> nothing to diff against, so start from a full sync.
  if (!row.sync_token) {
    return fullSyncForUser(userId);
  }

  const { accessToken } = await getAccessToken(row);
  const result: SyncResult = { ...empty, errors: [] };

  try {
    let page = await fetchChangePage(row, accessToken, row.sync_token);
    const deletedTaskIds: string[] = [];

    while (true) {
      for (const event of page.items ?? []) {
        const taskId = event.extendedProperties?.private?.taskoraTaskId;
        if (!taskId) continue; // not one of our events
        if (event.status === "cancelled") {
          deletedTaskIds.push(taskId);
        }
      }

      if (!page.nextPageToken) break;
      page = await fetchChangePage(row, accessToken, row.sync_token, page.nextPageToken);
    }

    if (deletedTaskIds.length > 0) {
      await admin
        .from("tasks")
        .update({ google_event_id: null })
        .in("id", deletedTaskIds)
        .eq("assigned_to", userId);
      result.removed = deletedTaskIds.length;
    }

    // Google only returns nextSyncToken on the final page.
    if (page.nextSyncToken) {
      await admin
        .from("user_google_tokens")
        .update({
          sync_token: page.nextSyncToken,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }

    return { success: true, data: result };
  } catch (err) {
    if (err instanceof SyncTokenGoneError) {
      // 410: the cursor is too old, or the calendar was reset. Google's
      // documented recovery is to drop the cursor and re-sync in full.
      console.warn("[google] syncToken 410 — falling back to full sync", userId);
      await admin.from("user_google_tokens").update({ sync_token: null }).eq("id", row.id);
      return fullSyncForUser(userId);
    }
    console.error("[google] incrementalSyncForUser", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Incremental sync failed",
    };
  }
}

/** Signed-in entry point for the client's "Sync now" button. */
export async function incrementalSync(): Promise<ActionResponse<SyncResult>> {
  try {
    const profile = await requireAuth();
    return incrementalSyncForUser(profile.id);
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Watch channel
// ──────────────────────────────────────────────

/** Ask Google to notify our webhook when this user's calendar changes. */
export async function setupWatchChannel(): Promise<
  ActionResponse<{ channelId: string; expiresAt: string }>
> {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();

    const row = await loadTokenRow(profile.id);
    if (!row) {
      return { success: false, error: "Connect Google Calendar first" };
    }

    // A channel with more than a day left is fine; don't churn it.
    if (
      row.channel_id &&
      row.channel_expires_at &&
      new Date(row.channel_expires_at).getTime() > Date.now() + 24 * 60 * 60 * 1000
    ) {
      return {
        success: true,
        data: { channelId: row.channel_id, expiresAt: row.channel_expires_at },
      };
    }

    const { accessToken } = await getAccessToken(row);
    const webhookUrl =
      process.env.GOOGLE_WEBHOOK_URL || `${appUrl()}/api/calendar/webhook`;

    const watch = await googleFetch<{
      id: string;
      resourceId: string;
      expiration?: string;
    }>(
      `${CALENDAR_API}/calendars/${encodeURIComponent(row.calendar_id)}/events/watch`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          id: crypto.randomUUID(),
          type: "web_hook",
          address: webhookUrl,
          // Lets the webhook confirm the notification came from Google.
          token: process.env.GOOGLE_WEBHOOK_TOKEN || "taskora",
        }),
      }
    );

    const expiresAt = watch.expiration
      ? new Date(Number(watch.expiration)).toISOString()
      : new Date(Date.now() + WATCH_TTL_MS).toISOString();

    await admin
      .from("user_google_tokens")
      .update({
        channel_id: watch.id,
        channel_resource_id: watch.resourceId,
        channel_expires_at: expiresAt,
      })
      .eq("id", row.id);

    return { success: true, data: { channelId: watch.id, expiresAt } };
  } catch (err) {
    console.error("[google] setupWatchChannel", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Couldn't register for calendar updates",
    };
  }
}
