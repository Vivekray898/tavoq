import { getInvitationByToken } from "@/lib/actions/invitations";
import { AcceptInvitation } from "@/components/auth/accept-invitation";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ accepted_auth?: string }>;
}) {
  const { token } = await params;
  const { accepted_auth } = await searchParams;

  const result = await getInvitationByToken(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-5 text-center">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Taskora</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Invitation
          </h1>
        </div>

        {result.success && result.data ? (
          <AcceptInvitation
            token={token}
            email={result.data.email}
            role={result.data.role}
            invitedByName={result.data.invitedByName}
            signedIn={accepted_auth === "1"}
          />
        ) : (
          <div className="rounded-xl border bg-card p-6">
            <p className="text-sm font-medium text-destructive">
              {result.error ?? "This invitation is not valid."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask your administrator to send a new invitation.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
