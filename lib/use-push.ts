"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Phase 2 — client-side push state machine.
 *
 * The five original states were not enough. Web Push on iOS has hard
 * requirements the old model could not express, and a user in any of these
 * states used to get a button that silently did nothing:
 *
 *   • iOS Safari in a browser tab — Safari exposes no PushManager at all.
 *   • iOS Chrome / Firefox on iOS — every iOS browser is WebKit, and only
 *     Safari 16.4+ supports Web Push. Chrome on iOS never will.
 *   • iOS Safari, but not added to the Home Screen — this is the case that
 *     looks like Safari and silently fails, so it gets its own state.
 *   • Permission granted but no subscription stored, e.g. after the Phase 1
 *     service worker URL change invalidated old subscriptions.
 */
export type PushState =
  | "unsupported"
  | "unsupported-ios-browser"
  | "ios-not-installed"
  | "denied"
  | "granted"
  | "subscribed"
  | "default";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports as Macintosh with touch points, so the UA sniff alone
  // misses it.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** iOS Safari only — the one iOS browser that can ever do Web Push. */
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
}

async function getExistingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function subscribe(): Promise<{ ok: boolean; reason?: string }> {
  const registration = await navigator.serviceWorker.ready;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    return { ok: false, reason: "Push isn't configured on this server yet." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Permission was declined." };

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const json = subscription.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  if (!res.ok) {
    // Surface the server's reason rather than a bare "failed".
    let reason = "Couldn't save this subscription.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) reason = body.error;
    } catch {
      // keep the default
    }
    return { ok: false, reason };
  }
  return { ok: true };
}

/**
 * §19 — browser notification permission, handled respectfully:
 * never prompts on load; the user must click "Enable notifications".
 */
export function usePushNotifications() {
  const [state, setState] = useState<PushState>("default");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;

      const ios = isIos();
      const standalone = isStandalone();

      // iOS-specific states take priority: on iOS the browser tells you
      // nothing useful, so asking about PushManager first hides the real
      // problem behind a misleading "unsupported".
      if (ios && !isIosSafari()) {
        if (!cancelled) setState("unsupported-ios-browser");
        return;
      }
      if (ios && !standalone) {
        if (!cancelled) setState("ios-not-installed");
        return;
      }

      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      const permission = Notification.permission;
      if (permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      if (permission === "granted") {
        const existing = await getExistingSubscription().catch(() => null);
        if (!cancelled) setState(existing ? "subscribed" : "granted");
        return;
      }
      if (!cancelled) setState("default");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (working) return;
    setWorking(true);
    try {
      const { ok, reason } = await subscribe();
      if (ok) {
        setState("subscribed");
        toast.success("Notifications enabled");
      } else {
        if (Notification.permission === "denied") setState("denied");
        // Say WHY it failed. A silent no-op here is the single most
        // confusing thing this component used to do.
        if (reason) toast.error(reason);
      }
    } catch (err) {
      console.error("[usePush] subscribe failed:", err);
      toast.error("Couldn't enable notifications. Please try again.");
    } finally {
      setWorking(false);
    }
  }, [working]);

  const disable = useCallback(async () => {
    setWorking(true);
    try {
      const existing = await getExistingSubscription().catch(() => null);
      if (existing) {
        await existing.unsubscribe().catch(() => {});
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        }).catch(() => {});
      }
      setState("granted");
      toast.success("Notifications turned off on this device");
    } finally {
      setWorking(false);
    }
  }, []);

  return { state, working, enable, disable };
}