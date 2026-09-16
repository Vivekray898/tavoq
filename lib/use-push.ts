"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export type PushState =
  | "unsupported"
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

async function getExistingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function subscribe(): Promise<boolean> {
  const registration = await navigator.serviceWorker.ready;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    toast.error("Push isn't configured on this server yet.");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

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
  return res.ok;
}

/**
 * §19 — browser notification permission, handled respectfully:
 * never prompts on load; the user must click "Enable notifications".
 * Exposes the four states: default / granted / denied / unsupported.
 */
export function usePushNotifications() {
  const [state, setState] = useState<PushState>("default");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
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
      const ok = await subscribe();
      if (ok) {
        setState("subscribed");
        toast.success("Notifications enabled");
      } else if (Notification.permission === "denied") {
        setState("denied");
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
