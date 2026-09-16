import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("status, role")
          .eq("id", user.id)
          .single();

        if (profile?.status === "SUSPENDED") {
          return NextResponse.redirect(`${origin}/suspended`);
        }
        if (profile?.status === "PENDING" || !profile?.role) {
          return NextResponse.redirect(`${origin}/pending`);
        }
        if (profile.role === "ADMIN") {
          return NextResponse.redirect(`${origin}/admin`);
        }
        return NextResponse.redirect(`${origin}/employee`);
      }
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
