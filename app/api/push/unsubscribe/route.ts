import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Remove this device's push subscription (user-initiated opt-out). */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { endpoint?: string };
    if (!body.endpoint) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.endpoint);

    if (error) {
      console.error("[push/unsubscribe]", error);
      return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/unsubscribe]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
