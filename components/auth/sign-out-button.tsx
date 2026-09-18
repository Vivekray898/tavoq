"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  async function signOut() {
    setIsLoading(true);
    const { error } = await createClient().auth.signOut();

    if (error) {
      toast.error(error.message || "Unable to sign out");
      setIsLoading(false);
      return;
    }

    // Clear every user-specific cache entry + unsubscribe realtime (§19).
    queryClient.clear();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" onClick={signOut} disabled={isLoading}>
      {isLoading ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Sign out
    </Button>
  );
}
