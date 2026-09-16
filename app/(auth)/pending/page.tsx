import { SignOutButton } from "@/components/auth/sign-out-button";
import { notifyAdminsOfPendingAccount } from "@/lib/actions/invitations";

// Reads the session (cookies) to notify admins — must render per-request
export const dynamic = "force-dynamic";

export default async function PendingPage() {
  // §21 — tell active admins (once per day per pending account) that
  // this account is waiting for review. Safe to fire on every view.
  await notifyAdminsOfPendingAccount().catch(() => {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-5 text-center">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Taskora</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Waiting for approval
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your Google account is signed in, but an admin must approve access
            before you can use Taskora.
          </p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3 text-left text-sm">
          <p className="text-muted-foreground">Status</p>
          <p className="mt-1 flex items-center gap-2 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Pending approval
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Please contact your administrator if you believe this is taking too long.
        </p>
        <SignOutButton />
      </section>
    </main>
  );
}
