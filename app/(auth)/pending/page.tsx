import { SignOutButton } from "@/components/auth/sign-out-button";

export default function PendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-5 text-center">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Taskora</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Waiting for approval</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your Google account is signed in, but an admin must approve access before you can use Taskora.
          </p>
        </div>
        <SignOutButton />
      </section>
    </main>
  );
}
