"use client";

import { useEffect, useState } from "react";
import { useSerwist } from "@serwist/turbopack/react";
import { toast } from "sonner";
import { Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "taskora-install-dismissed";
const DISMISS_DURATION = 1000 * 60 * 60 * 24 * 14; // 14 days

/**
 * Phase 1 — install and update UX.
 *
 * Registration itself now lives in <SerwistProvider> (app/layout.tsx), which
 * handles the whole Serwist lifecycle. What remains here is the UX that
 * surrounds it:
 *
 *   1. the install prompt, for browsers that fire `beforeinstallprompt`
 *      (Chromium-based desktop and Android);
 *   2. update-available detection, because Serwist is configured with
 *      skipWaiting: true — a new worker activates on its own and the open tab
 *      must be told, or the user keeps interacting with a stale app until they
 *      happen to reload;
 *   3. iOS Add-to-Home-Screen guidance. Safari never fires
 *      `beforeinstallprompt`, so without this an iOS user gets no install
 *      affordance at all and no idea the app is installable.
 */
export function PwaBootstrap() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showPrompt, setShowPrompt] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  // ── Update available ───────────────────────────────────────────────────
  const { serwist } = useSerwist();

  useEffect(() => {
    if (!serwist) return;

    let reloading = false;
    const onNeedRefresh = () => {
      // The new worker is already active (skipWaiting), so a reload is enough
      // to hand control to it. Guard against the reload-on-controlling event
      // firing twice and bouncing the user in a loop.
      toast("A new version of Taskora is ready", {
        description: "Reload to get the latest version.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            reloading = true;
            window.location.reload();
          },
        },
      });
    };

    const onOfflineReady = ({
      isUpdate,
    }: {
      isUpdate?: boolean;
    }) => {
      // Serwist's event map has no `offlineReady` — the valid lifecycle events
      // are installing/installed/waiting/activating/activated/controlling/
      // redundant. `activated` fires once the worker is live and controlling
      // its scope, which is the point offline capability actually exists.
      // isUpdate distinguishes a deploy from the very first activation, so the
      // announcement is not repeated on every ordinary page load.
      if (!isUpdate) toast.success("Taskora is ready to work offline");
    };

    serwist.addEventListener("waiting", onNeedRefresh);
    serwist.addEventListener("activated", onOfflineReady);

    return () => {
      serwist.removeEventListener("waiting", onNeedRefresh);
      serwist.removeEventListener("activated", onOfflineReady);
      if (reloading) window.location.reload();
    };
  }, [serwist]);

  // ── Install prompt (§40): only if not previously dismissed ─────────────
  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      const dismissedAt = localStorage.getItem(DISMISS_KEY);
      if (
        dismissedAt &&
        Date.now() - Number(dismissedAt) < DISMISS_DURATION
      ) {
        return;
      }
      setInstallEvent(e as BeforeInstallPromptEvent);
      // Small delay so it never fights with first-load UI
      setTimeout(() => setShowPrompt(true), 3000);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS Safari never fires beforeinstallprompt. Show the manual
    // instructions instead — but only when actually running as an iOS browser
    // that is not already installed, and only outside the standalone app where
    // they would be nonsense.
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari reports standalone through navigator instead of display-mode.
      (navigator as { standalone?: boolean }).standalone === true;
    if (isIos && !isStandalone) {
      const dismissedAt = localStorage.getItem(DISMISS_KEY);
      if (!dismissedAt || Date.now() - Number(dismissedAt) >= DISMISS_DURATION) {
        setTimeout(() => setShowIosHint(true), 5000);
      }
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") {
      setShowPrompt(false);
    }
    setInstallEvent(null);
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShowPrompt(false);
    setShowIosHint(false);
  }

  if (!showPrompt && !showIosHint) return null;

  if (showIosHint && !showPrompt) {
    return (
      <div
        className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-xl border bg-popover p-3.5 shadow-lg lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        role="dialog"
        aria-label="Add Taskora to your Home Screen"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Add Taskora to Home Screen</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tap <Share className="mx-0.5 inline size-3" aria-hidden="true" /> Share,
            then{" "}
            <span className="font-medium text-foreground">
              Add to Home Screen
            </span>
            . Taskora then opens full-screen and supports notifications.
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleDismiss}
          aria-label="Not now"
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  if (!showPrompt || !installEvent) return null;

  return (
    <div
      className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-xl border bg-popover p-3.5 shadow-lg lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-label="Install Taskora"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
        T
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Install Taskora</p>
        <p className="text-xs text-muted-foreground">
          Get faster access from your home screen.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={handleInstall}>
          Install
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleDismiss}
          aria-label="Not now"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}