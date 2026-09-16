"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { acceptInvitation } from "@/lib/actions/invitations";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AcceptInvitationProps {
  token: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE";
  invitedByName: string | null;
  signedIn: boolean;
}

/**
 * §10 — the invitation acceptance surface. The Google account email
 * must match the invited address; the server enforces this in
 * acceptInvitation() and the account is only activated on a match.
 */
export function AcceptInvitation({
  token,
  email,
  role,
  invitedByName,
  signedIn,
}: AcceptInvitationProps) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  // After the OAuth redirect back to this page, accept immediately
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setWorking(true);
      acceptInvitation(token).then((result) => {
        if (cancelled) return;
        if (result.success) {
          toast.success("Invitation accepted — welcome to Taskora!");
          router.replace("/");
          router.refresh();
        } else {
          setWorking(false);
          toast.error(result.error ?? "Couldn't accept the invitation");
          // Stay on the page so the user can retry with the right account
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, token, router]);

  async function continueWithGoogle() {
    setWorking(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?invite_token=${encodeURIComponent(token)}`,
      },
    });
    if (error) {
      toast.error(error.message || "Unable to continue with Google");
      setWorking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 text-left">
        <p className="text-sm text-muted-foreground">Invited email address</p>
        <p className="mt-1 font-medium break-all">{email}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          {invitedByName
            ? `${invitedByName} invited you to join as `
            : "You've been invited to join as "}
          <span className="font-medium text-foreground">
            {role === "ADMIN" ? "an administrator" : "a team member"}
          </span>
          .
        </p>
      </div>

      <p className="text-[13px] text-muted-foreground">
        Sign in with the Google account for <strong>{email}</strong>. Other
        accounts can&apos;t use this invitation.
      </p>

      <Button
        type="button"
        className={cn("w-full")}
        disabled={working}
        onClick={continueWithGoogle}
      >
        {working ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Working…
          </>
        ) : (
          "Continue with Google"
        )}
      </Button>
    </div>
  );
}
