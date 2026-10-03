import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountDestination } from "@/lib/permissions";

/**
 * OAuth callback. Routes strictly by the profile's SERVER-SIDE
 * account state — never by anything the client sent:
 *
 *   SUSPENDED            → /suspended (blocked)
 *   PENDING / no profile / no role → /pending (blocked)
 *   SUPER_ADMIN          → /admin
 *   MANAGER / EMPLOYEE   → / (workspace)
 *
 * If the sign-in started from an invitation, we bounce back to the
 * invite page (with the token) so it can accept server-side after
 * verifying the Google email matches the invited address.
 *
 * IDEMPOTENCE — a one-time code must only ever be spent once.
 * A browser can reach this URL more than once for the same sign-in:
 * a refresh, a back/forward navigation, a prefetch, or a restored tab
 * all re-request it with the same `code`. Supabase's
 * exchangeCodeForSession is a one-shot operation, so the second attempt
 * fails with an opaque "Invalid Refresh Token" / "already used" error
 * and the user is bounced to /login *even though the first attempt
 * already signed them in*. That is a self-inflicted version of the
 * redirect loop.
 *
 * So: if a session already exists, the code has already been spent.
 * Skip the exchange entirely and route on the profile that session
 * belongs to. Only spend the code when there is genuinely no session.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const inviteToken = searchParams.get("invite_token");

  // Already signed in — this code was spent on an earlier hit.
  const { data: existing } = await (await createClient()).auth.getUser();
  if (existing.user) {
    if (inviteToken) {
      return NextResponse.redirect(
        `${origin}/invite/${inviteToken}?accepted_auth=1`
      );
    }
    return NextResponse.redirect(
      `${origin}${await destinationFor(existing.user.id)}`,
    );
  }

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
        return NextResponse.redirect(`${origin}${await destinationFor(user.id)}`);
      }
    } else {
      // Keep the provider's own wording. A generic "Google sign-in
      // failed" hides the two cases that actually need a human:
      //   - "email already registered": a legacy email/password user
      //     signing in with Google for the first time while automatic
      //     account linking is disabled
      //   - "invalid/expired code": the one-time code was already
      //     spent, which is a retry, not a broken integration
      const message = error.message.includes("already")
        ? "An account with this email already exists. Sign in with your original method, or ask your admin to enable automatic account linking."
        : `Google sign-in failed: ${error.message}`;
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

/** The shared routing table, keyed on the signed-in user id. */
async function destinationFor(userId: string): Promise<string> {
  const { data: profile } = await (
    await createClient()
  )
    .from("profiles")
    .select("status, role")
    .eq("id", userId)
    .single();

  // Same routing table the /login page uses. Keeping one implementation
  // is what stops the two from disagreeing and re-opening the loop.
  return getAccountDestination(profile ?? null);
}
