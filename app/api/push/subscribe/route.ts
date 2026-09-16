import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * §20 — store the browser's push subscription for the signed-in user.
 * The subscription endpoint is unique per device, so re-subscribing
 * the same browser updates the row instead of duplicating it.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: body.endpoint,
          keys_p256dh: body.keys.p256dh,
          keys_auth: body.keys.auth,
          user_agent: request.headers.get("user-agent") ?? null,
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      console.error("[push/subscribe]", error);
      return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
