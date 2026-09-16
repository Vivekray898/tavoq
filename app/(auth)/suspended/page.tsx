import { SignOutButton } from "@/components/auth/sign-out-button";

export default function SuspendedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-5 text-center">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Taskora</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your account is suspended</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Authentication succeeded, but access to Taskora is currently blocked. Contact an admin if you think this is a mistake.
          </p>
        </div>
        <SignOutButton />
      </section>
    </main>
  );
}
