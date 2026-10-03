import { redirect } from "next/navigation";
import { getSessionUserId, getUserProfile } from "@/lib/auth";
import { getAccountDestination } from "@/lib/permissions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * Sign-in.
 *
 * Server Component on purpose. This page is the other end of the OAuth
 * callback, so it has to resolve the session and route on the profile's
 * account state BEFORE rendering anything. As a client component it
 * rendered the "Continue with Google" screen unconditionally and threw
 * away the callback's `?error=` — which is exactly what produced the
 * redirect loop: a failed callback bounced here, the message was
 * dropped, the button looked identical, the user clicked again, and the
 * pair repeated indefinitely.
 *
 * Routing table (never back to /login for a signed-in user):
 *   no session                       → render the sign-in screen
 *   session, profile unreadable      → diagnostic + sign out
 *   PENDING / no role                → /pending
 *   SUSPENDED                        → /suspended
 *   SUPER_ADMIN                      → /admin
 *   MANAGER / EMPLOYEE               → /
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const userId = await getSessionUserId();

  if (userId) {
    const profile = await getUserProfile();
    // A signed-in user never sees the sign-in screen again. If their
    // profile row cannot be read, show what is actually wrong instead of
    // redirecting — a redirect would put them right back here and restart
    // the loop with no way to see the cause.
    if (!profile) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <section className="w-full max-w-sm space-y-5 text-center">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Taskora</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Signed in, but no profile found
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your Google account is authenticated, but Taskora could not
                load its profile row. This is an account-setup problem, not
                a sign-in problem — signing in again will not fix it.
              </p>
            </div>
            <div className="space-y-3 rounded-xl border bg-card px-4 py-3 text-left text-sm">
              <div>
                <p className="text-muted-foreground">Signed-in user</p>
                <p className="mt-1 font-mono text-xs">{userId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Usual causes</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  <li>No row exists in profiles for this account</li>
                  <li>The row has a null role or a non-ACTIVE status</li>
                  <li>An RLS policy is blocking the self-read</li>
                </ul>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Ask an administrator to check your account, then sign in again.
            </p>
            <SignOutButton />
          </section>
        </main>
      );
    }

    redirect(getAccountDestination(profile));
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Taskora</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-left text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        <GoogleSignInButton />
      </div>
    </main>
  );
}
