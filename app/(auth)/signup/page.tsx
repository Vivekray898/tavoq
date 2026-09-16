"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false);

  async function continueWithGoogle() {
    setIsLoading(true);

    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      toast.error(error.message || "Unable to continue with Google");
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Taskora</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            New accounts wait for admin approval.
          </p>
        </div>

        <Button
          type="button"
          className="w-full"
          disabled={isLoading}
          onClick={continueWithGoogle}
        >
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Connecting...
            </>
          ) : (
            "Continue with Google"
          )}
        </Button>
      </div>
    </div>
  );
}