import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * §20 — real Web Push architecture:
 *   service worker (public/sw.js) ← push event
 *   /api/push/subscribe           → push_subscriptions row
 *   lib/push.ts (this file)       → web-push send per device
 *
 * Configure VAPID keys via:
 *   npx web-push generate-vapid-keys
 * then set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY +
 * VAPID_SUBJECT. If unset, push is silently skipped (the in-app
 * notification center still works).
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
}

/** Fire-and-forget — push must never break the main action. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  try {
    if (!ensureConfigured()) return;

    const admin = createAdminClient();
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, keys_p256dh, keys_auth")
      .eq("user_id", userId);

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
