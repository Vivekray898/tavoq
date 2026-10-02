/**
 * Pure builders for the Google Calendar integration.
 *
 * These live apart from lib/actions/google-calendar.ts on purpose. The
 * action module is `"use server"` and imports next/headers, the
 * Supabase clients and the auth helpers, so nothing in it can be
 * loaded by the test runner. The two pieces with real logic worth
 * pinning down — the authorize URL parameters and the event payload
 * Google will accept — are extracted here so they can be tested
 * directly instead of being asserted on as source text.
 *
 * Nothing in this file performs I/O.
 */

/** Trailing slashes must not leak into the redirect_uri. */
export function normalizeAppUrl(raw: string | undefined): string {
  return (raw || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * The OAuth callback path, which Google must have registered exactly.
 *
 * The origin is normalised here as well as at the call site: a
 * trailing slash produces a double slash, and a double slash is a
 * `redirect_uri_mismatch` at the token exchange — a failure that
 * presents as a generic "Couldn't connect".
 */
export function callbackRedirectUri(appUrl: string): string {
  return `${normalizeAppUrl(appUrl)}/api/auth/google/callback`;
}

/**
 * Parameters for the consent screen.
 *
 * `access_type=offline` and `prompt=consent` are load-bearing, not
 * decoration. Without them Google returns a refresh token only on the
 * very first authorisation, so a user who revoked and reconnected
 * would silently get an access token that dies in an hour and the sync
 * would stop with nothing in the logs. `include_granted_scopes` keeps
 * previously granted scopes when the list grows.
 */
export function buildAuthorizeParams({
  clientId,
  redirectUri,
  scopes,
  state,
}: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
}

export interface SyncableTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  project_id: string;
  google_event_id: string | null;
  project?: { name: string; client?: { name: string } | null } | null;
}

/**
 * The event body sent to calendar.events.insert / .update.
 *
 * Two rules Google enforces strictly:
 *  • An all-day event needs `start.date` / `end.date` as YYYY-MM-DD
 *    strings, never ISO timestamps — sending `dateTime` there is a 400.
 *  • `end` is exclusive, so an all-day event on the 3rd ends on the 4th.
 *
 * A task with no deadline cannot become an all-day event, so it falls
 * back to a one-hour timed event starting now rather than being sent
 * with an undefined start (which Google also rejects).
 */
export function buildEventBody(task: SyncableTask): Record<string, unknown> {
  const projectName = task.project?.name ?? "";
  const clientName = task.project?.client?.name ?? "";

  const descriptionLines = [
    task.description?.trim() || "",
    projectName ? `Project: ${projectName}` : "",
    clientName ? `Client: ${clientName}` : "",
    `Priority: ${task.priority}`,
    `Status: ${task.status}`,
    `Taskora task id: ${task.id}`,
  ].filter(Boolean);

  const body: Record<string, unknown> = {
    summary: task.title,
    description: descriptionLines.join("\n"),
    // The task id is stable, so re-running sync updates in place
    // instead of creating duplicate events.
    extendedProperties: { private: { taskoraTaskId: task.id } },
  };

  const deadline = task.deadline ? new Date(task.deadline) : null;

  if (deadline && !isNaN(deadline.getTime())) {
    // All-day events use an exclusive end date.
    const end = new Date(deadline.getTime() + 24 * 60 * 60 * 1000);
    body.start = { date: deadline.toISOString().slice(0, 10) };
    body.end = { date: end.toISOString().slice(0, 10) };
  } else {
    // No deadline, or one that does not parse. Both used to leave the
    // body without a `start` at all — an invalid date fell through the
    // if/else rather than reaching the fallback — and Google answers
    // that with a 400 that arrived as an invisible per-task error.
    const start = new Date();
    body.start = { dateTime: start.toISOString(), timeZone: "UTC" };
    body.end = {
      dateTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      timeZone: "UTC",
    };
  }

  return body;
}