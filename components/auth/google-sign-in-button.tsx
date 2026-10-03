"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * The Google OAuth trigger. Split out of the login page so that page can
 * be a Server Component: it has to resolve the session and route on the
 * profile's status before rendering anything, which a client component
 * cannot do safely (it would render the sign-in screen first and then
 * redirect — the exact flash-and-bounce that produced the loop).
 */
export function GoogleSignInButton() {
  const [isLoading, setIsLoading] = useState(false);

  async function continueWithGoogle() {
    setIsLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      toast.error(error.message || "Unable to continue with Google");
      setIsLoading(false);
    }
  }

  return (
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
  );
}
