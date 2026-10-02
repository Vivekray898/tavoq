import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { handleGoogleCallback } from "@/lib/actions/google-calendar";

/**
 * Google OAuth redirect target.
 *
 * Google sends the user here with ?code=...&state=.... We verify the
 * state against the cookie we set in connectGoogleCalendar (CSRF
 * protection), exchange the code for tokens, then send the user back
 * to the profile page with a result flag the UI renders.
 *
 * Supabase Auth is untouched — this is an app-level grant, separate
 * from how the user signs in.
 */

const STATE_COOKIE = "gcal_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const profileUrl = new URL("/profile", origin);
  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value;

  // Always clear the one-shot state cookie, success or not.
  jar.delete(STATE_COOKIE);

  if (oauthError) {
    profileUrl.searchParams.set("gcal", "denied");
    return NextResponse.redirect(profileUrl);
  }

  if (!code || !state || !stored) {
    profileUrl.searchParams.set("gcal", "invalid");
    return NextResponse.redirect(profileUrl);
  }

  // Stored value is "<state>:<userId>:<issuedAtMs>".
  const [expectedState, userId, issuedAtRaw] = stored.split(":");
  const issuedAt = Number(issuedAtRaw);
  const expired = !Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS;

  if (!expectedState || !userId || expired || expectedState !== state) {
    profileUrl.searchParams.set("gcal", "invalid");
    return NextResponse.redirect(profileUrl);
  }

  // The state cookie must belong to the same browser session that is
  // completing the flow.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== userId) {
    profileUrl.searchParams.set("gcal", "unauthorized");
    return NextResponse.redirect(profileUrl);
  }

  const result = await handleGoogleCallback(code, user.id);

  profileUrl.searchParams.set("gcal", result.success ? "connected" : "error");
  return NextResponse.redirect(profileUrl);
}
