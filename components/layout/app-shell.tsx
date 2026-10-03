"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { MobileMenuButton } from "@/components/layout/mobile-menu-button";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { KeyboardShortcuts } from "@/components/shared/keyboard-shortcuts";
import { SearchDialog } from "@/components/shared/search-dialog";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

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
        <MobileHeader onMenuClick={() => setNavOpen(true)} />

        {isOffline && (
          <div className="border-b bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            You&apos;re offline — some actions may be unavailable.
          </div>
        )}

        {/* Hamburger for the dashboard and detail pages, which draw their
            own headers and so get no hamburger from MobileHeader. */}
        <MobileMenuButton onMenuClick={() => setNavOpen(true)} />

        <main
          className={cn(
            "flex-1 overflow-y-auto",
            // pb-6 rather than the old pb-24: the fixed bottom bar that
            // needed clearing is gone. The safe-area inset still applies,
            // so content never sits flush against the home indicator.
            "px-4 pb-6 pt-4 lg:px-8 lg:pb-10 lg:pt-6"
          )}
          style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>

      {/* Discord-style drawer replaces the fixed bottom bar (§71 mobile).
          One source of truth for open state, shared by both hamburgers. */}
      <MobileNavDrawer open={navOpen} onOpenChange={setNavOpen} />
      {/* §2/§20 — desktop quick actions + shortcuts (session-gated) */}
      <KeyboardShortcuts />
      {/* Shell-level search dialog — reachable from the mobile header and shortcuts */}
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
