import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { incrementalSyncForUser } from "@/lib/actions/google-calendar";

/**
 * Google Calendar push notification endpoint.
 *
 * Google POSTs here with an empty body whenever a watched calendar
 * changes; the useful bits are in headers (X-Goog-Channel-Id,
 * X-Goog-Resource-State). The payload carries no event data, so we
 * re-query using the stored syncToken — that's incrementalSyncForUser.
 *
 * Google requires a fast 2xx; it retries on failure. We acknowledge
 * immediately and do the work after responding so a slow sync never
 * causes a retry storm.
 */

export const dynamic = "force-dynamic";

/** Google sends a "sync" notification when the channel is first created. */
export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceState = request.headers.get("x-goog-resource-state");
  const channelToken = request.headers.get("x-goog-channel-token");

  if (!channelId) {
    return NextResponse.json({ ok: false, error: "missing channel id" }, { status: 400 });
  }

  // Verify the notification really came from Google, not a random caller.
  const expectedToken = process.env.GOOGLE_WEBHOOK_TOKEN || "taskora";
  if (channelToken && channelToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "bad token" }, { status: 403 });
  }

  // The initial handshake only confirms the channel is live.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true, state: resourceState });
  }

  // Find which user's channel this is, then sync them. Fire-and-forget
  // after the 2xx so Google isn't kept waiting.
  void (async () => {
    try {
      const { data } = await createAdminClient()
        .from("user_google_tokens")
        .select("user_id")
        .eq("channel_id", channelId)
        .maybeSingle();

      const userId = (data as { user_id: string } | null)?.user_id;
      if (!userId) {
        console.warn("[google webhook] no user for channel", channelId);
        return;
      }

      const result = await incrementalSyncForUser(userId);
      if (!result.success) {
        console.error("[google webhook] sync failed", result.error);
      }
    } catch (err) {
      console.error("[google webhook] unexpected", err);
    }
  })();

  return NextResponse.json({ ok: true });
}

/** Google validates reachability with a GET during channel setup. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "google-calendar-webhook" });
}
