import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Routes strictly by the profile's SERVER-SIDE
 * account state — never by anything the client sent:
 *
 *   SUSPENDED            → /suspended (blocked)
 *   PENDING / no profile / no role → /pending (blocked)
 *   ADMIN                → /admin
 *   EMPLOYEE             → / (employee workspace)
 *
 * If the sign-in started from an invitation, we bounce back to the
 * invite page (with the token) so it can accept server-side after
 * verifying the Google email matches the invited address.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const inviteToken = searchParams.get("invite_token");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // An invitation flow: let the invite page validate + accept.
      if (inviteToken) {
        return NextResponse.redirect(
          `${origin}/invite/${inviteToken}?accepted_auth=1`
        );
      }

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("status, role")
          .eq("id", user.id)
          .single();

        if (!profile || profile.status === "PENDING" || !profile.role) {
          return NextResponse.redirect(`${origin}/pending`);
        }
        if (profile.status === "SUSPENDED") {
          return NextResponse.redirect(`${origin}/suspended`);
        }
        if (profile.role === "ADMIN") {
          return NextResponse.redirect(`${origin}/admin`);
        }
        return NextResponse.redirect(`${origin}/`);
      }
    } else {
      // Common OAuth failure: e.g. "email already registered" when a
      // legacy email/password user signs in with Google for the first
      // time and auto-linking is disabled in Supabase Auth settings.
      const message = error.message.includes("already")
        ? "An account with this email already exists. Sign in with your original method, or ask your admin to enable automatic account linking."
        : "Google sign-in failed. Please try again.";
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(message)}`
      );
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Sign-in could not be completed. Please try again.")}`
  );
}
