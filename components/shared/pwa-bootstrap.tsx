"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "taskora-install-dismissed";
const DISMISS_DURATION = 1000 * 60 * 60 * 24 * 14; // 14 days

export function PwaBootstrap() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showPrompt, setShowPrompt] = useState(false);

  // Register the service worker
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[pwa] SW registration failed:", err);
      });
    }
  }, []);

  // Install prompt (§40): only if not previously dismissed
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
