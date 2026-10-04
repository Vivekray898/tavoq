"use client";

import { useState, useTransition } from "react";
import { BellOff, BellRing, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/lib/use-push";
import { sendTestPush } from "@/lib/actions/notifications";

/**
 * §19 — explicit, user-initiated browser notification opt-in.
 * Never auto-prompts; explains the value first; handles denied.
 *
 * Phase 2 added the states that previously produced a dead button:
 * iOS-not-installed, and Chrome/Firefox on iOS (no Web Push support at all).
 */
export function PushPermissionCard() {
  const { state, working, enable, disable } = usePushNotifications();
  const [pending, startTransition] = useTransition();
  const [testResult, setTestResult] = useState<string | null>(null);

  function handleTest() {
    setTestResult(null);
    startTransition(async () => {
      const res = await sendTestPush();
      if (res.success) {
        setTestResult(
          `Sent to ${res.devices} device${res.devices === 1 ? "" : "s"}.`
        );
      } else {
        setTestResult(res.error ?? "Couldn't send a test notification.");
      }
    });
  }

  const shell = (icon: React.ReactNode, body: React.ReactNode, action?: React.ReactNode) => (
    <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
      {icon}
      <div className="min-w-0 flex-1 text-sm">{body}</div>
      {action}
    </div>
  );

  if (state === "unsupported") {
    return shell(
      <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
      <>
        <p className="font-medium">Browser notifications unavailable</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          This browser doesn&apos;t support push notifications. In-app
          notifications still work everywhere.
        </p>
      </>
    );
  }

  if (state === "unsupported-ios-browser") {
    return shell(
      <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
      <>
        <p className="font-medium">Not supported in this browser</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          On iOS, only Safari supports notifications — and only once Taskora
          has been added to your Home Screen. Open this page in Safari to set
          that up. In-app notifications work here regardless.
        </p>
      </>
    );
  }

  if (state === "ios-not-installed") {
    return shell(
      <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
      <>
        <p className="font-medium">Add Taskora to your Home Screen first</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          iOS only delivers notifications to apps installed from the Home
          Screen. Tap Share, then <span className="font-medium">Add to Home Screen</span>,
          reopen Taskora from there, and notifications become available.
        </p>
      </>
    );
  }

  if (state === "denied") {
    return shell(
      <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
      <>
        <p className="font-medium">Browser notifications are blocked</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          You can enable them from your browser&apos;s site settings — click
          the lock/site icon in the address bar, then allow notifications.
        </p>
      </>
    );
  }

  if (state === "subscribed") {
    return shell(
      <BellRing className="mt-0.5 size-4 shrink-0 text-emerald-500" />,
      <>
        <p className="font-medium">Notifications are on</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          You&apos;ll get system notifications on this device even when
          Taskora is closed.
        </p>
        {testResult && (
          <p className="mt-2 text-[13px] font-medium text-foreground">{testResult}</p>
        )}
      </>,
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Send test
        </Button>
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

  // "granted" means permission is allowed but this device has no stored
  // subscription — e.g. after the Phase 1 worker URL change invalidated the
  // old one. Offer a re-subscribe rather than a dead end.
  if (state === "granted") {
    return shell(
      <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />,
      <>
        <p className="font-medium">Notifications allowed, but not set up</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Permission is already granted for this site, but this device has no
          active subscription. Re-enable to reconnect it.
        </p>
      </>,
      <Button type="button" size="sm" onClick={enable} disabled={working}>
        {working && <Loader2 className="size-3.5 animate-spin" />}
        Enable notifications
      </Button>
    );
  }

  return shell(
    <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />,
    <>
      <p className="font-medium">Notifications</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Get instant notifications when you&apos;re assigned tasks, receive
        comments, or your work is reviewed.
      </p>
    </>,
    <Button type="button" size="sm" onClick={enable} disabled={working}>
      {working && <Loader2 className="size-3.5 animate-spin" />}
      Enable notifications
    </Button>
  );
}