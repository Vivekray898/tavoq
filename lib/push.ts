import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_PREFERENCES,
  shouldSendPush,
  type NotificationPreferences,
} from "@/lib/push-preferences";

/**
 * Phase 2 — Web Push delivery.
 *
 *   service worker (app/sw.ts)        ← push event
 *   /api/push/subscribe               → push_subscriptions row
 *   lib/push.ts (this file)           → web-push, one send per device
 *
 * Configure VAPID keys via:
 *   npx web-push generate-vapid-keys
 * then set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY +
 * VAPID_SUBJECT. If unset, push is silently skipped (the in-app
 * notification center still works).
 *
 * Every send is preference-gated, deduplicated, and stamps
 * last_success_at so an unhealthy device can be identified.
 */

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  configured = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  if (configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@taskora.app",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
  }
  return configured;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /**
   * Notification type, used to look up the user's preference for this
   * channel. Omitted only by the manual "send test" path, which always
   * sends.
   */
  type?: string;
  /** Dedupe key. When set, a repeat delivery for the same key is skipped. */
  dedupeKey?: string;
  /** Skip the preference lookup entirely (manual test sends). */
  force?: boolean;
}

/** Load the user's preferences, falling back to all-on when no row exists. */
async function loadPreferences(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<NotificationPreferences> {
  const { data, error } = await admin
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return DEFAULT_PREFERENCES;
  return { ...DEFAULT_PREFERENCES, ...(data as NotificationPreferences) };
}

/**
 * Claim a dedupe key. Returns false when it has already been used, which
 * means this delivery must be skipped.
 *
 * The unique index on dedupe_key is what actually enforces this, so two
 * concurrent duplicates cannot both win the race.
 */
async function claimDedupeKey(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  key: string
): Promise<boolean> {
  const { error } = await admin.from("push_delivery_log").insert({
    user_id: userId,
    dedupe_key: key,
    channel: "PUSH",
  });
  // 23505 = unique violation: already delivered for this key.
  if (error) {
    if ((error as { code?: string }).code === "23505") return false;
    console.error("[sendPushToUser] dedupe claim failed:", error);
    // Fail open: a broken log must not silently swallow every push.
    return true;
  }
  return true;
}

/** Fire-and-forget — push must never break the main action. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  try {
    if (!ensureConfigured()) return;

    const admin = createAdminClient();

    // 1. Respect the user's preferences for this channel.
    if (!payload.force && payload.type) {
      const prefs = await loadPreferences(admin, userId);
      if (!shouldSendPush(prefs, payload.type)) return;
    }

    // 2. Dedupe, so a retried trigger cannot notify twice.
    if (payload.dedupeKey) {
      const claimed = await claimDedupeKey(admin, userId, payload.dedupeKey);
      if (!claimed) return;
    }

    // 3. Fan out to every device this user has subscribed.
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, keys_p256dh, keys_auth")
      .eq("user_id", userId)
      .eq("kind", "WEB_PUSH");

    if (!subs || subs.length === 0) return;

    const notification = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || "/notifications",
      tag: payload.tag,
    });

    await Promise.allSettled(
      subs.map(async (sub: { id: string; endpoint: string; keys_p256dh: string; keys_auth: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
            },
            notification
          );
          // Stamp delivery health only on a real success.
          await admin
            .from("push_subscriptions")
            .update({ last_success_at: new Date().toISOString() })
            .eq("id", sub.id);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404/410 = subscription gone — clean it up so we don't retry forever
          if (status === 404 || status === 410) {
            await admin
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id);
          } else {
            console.error("[sendPushToUser] device failed:", status);
          }
        }
      })
    );
  } catch (err) {
    console.error("[sendPushToUser] failed:", err);
  }
}

/** Send the same push to many users (e.g. all active admins). */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  if (userIds.length === 0) return;
  await Promise.allSettled(
    userIds.map((id) => sendPushToUser(id, payload))
  );
}

/**
 * Manual self-test, used by the "Send test notification" control.
 *
 * Bypasses preferences and dedupe on purpose — the point is to prove the
 * user's own device is reachable, so suppressing it would defeat the test.
 * Reports how many devices were reachable so the UI can say something
 * truthful instead of a generic success.
 */
export async function sendTestPushToUser(userId: string): Promise<{
  sent: boolean;
  devices: number;
  reason?: string;
}> {
  if (!ensureConfigured()) {
    return { sent: false, devices: 0, reason: "Push isn't configured on this server." };
  }
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, keys_p256dh, keys_auth")
    .eq("user_id", userId)
    .eq("kind", "WEB_PUSH");

  const devices = subs?.length ?? 0;
  if (devices === 0) {
    return {
      sent: false,
      devices: 0,
      reason: "No subscribed devices yet. Enable notifications on this device first.",
    };
  }

  const notification = JSON.stringify({
    title: "Taskora",
    body: "Test notification — push is working on this device.",
    url: "/notifications",
    tag: "taskora-test",
  });

  let delivered = 0;
  await Promise.allSettled(
    (subs as { id: string; endpoint: string; keys_p256dh: string; keys_auth: string }[]).map(
      async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
            notification
          );
          delivered += 1;
          await admin
            .from("push_subscriptions")
            .update({ last_success_at: new Date().toISOString() })
            .eq("id", sub.id);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }
    )
  );

  if (delivered === 0) {
    return {
      sent: false,
      devices,
      reason: "No device accepted the test push. Try re-enabling notifications.",
    };
  }
  return { sent: true, devices: delivered };
}