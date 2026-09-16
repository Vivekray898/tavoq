"use client";

import { BellOff, BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/lib/use-push";

/**
 * §19 — explicit, user-initiated browser notification opt-in.
 * Never auto-prompts; explains the value first; handles denied.
 */
export function PushPermissionCard() {
  const { state, working, enable, disable } = usePushNotifications();

  if (state === "unsupported") {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
        <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <p className="font-medium">Browser notifications unavailable</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            This browser doesn&apos;t support push notifications. In-app
            notifications still work everywhere.
          </p>
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
        <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <p className="font-medium">Browser notifications are blocked</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            You can enable them from your browser&apos;s site settings — click
            the lock/site icon in the address bar, then allow notifications.
          </p>
        </div>
      </div>
    );
  }

  if (state === "subscribed") {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
        <BellRing className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <div className="flex-1 text-sm">
          <p className="font-medium">Notifications are on</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            You&apos;ll get system notifications on this device even when
            Taskora is closed.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={disable}
          disabled={working}
        >
          Turn off
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
      <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Notifications</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Get instant notifications when you&apos;re assigned tasks, receive
          comments, or your work is reviewed.
        </p>
      </div>
      <Button type="button" size="sm" onClick={enable} disabled={working}>
        {working && <Loader2 className="size-3.5 animate-spin" />}
        Enable notifications
      </Button>
    </div>
  );
}
