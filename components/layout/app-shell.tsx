"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

export function AppShell({
  profile,
  children,
}: {
  profile: Profile & { role: NonNullable<Profile["role"]> };
  children: React.ReactNode;
}) {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    function goOnline() {
      setIsOffline(false);
    }
    function goOffline() {
      setIsOffline(true);
    }
    // Initialize in a microtask to avoid setState-in-effect lint error
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setIsOffline(!navigator.onLine);
    });
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar role={profile.role} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar profile={profile} />
        <MobileHeader />

        {isOffline && (
          <div className="border-b bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            You&apos;re offline — some actions may be unavailable.
          </div>
        )}

        <main
          className={cn(
            "flex-1 overflow-y-auto",
            "px-4 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-6"
          )}
        >
          {/* Bottom padding on mobile clears the fixed bottom nav + safe area (§42) */}
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>

      <MobileNav role={profile.role} />
    </div>
  );
}
