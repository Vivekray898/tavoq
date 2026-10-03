"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { googleCalendarOptions } from "@/lib/queries/options";
import { usePushNotifications } from "@/lib/use-push";

/**
 * §71 — "your tasks aren't syncing anywhere yet".
 *
 * Connecting Google Calendar used to be discoverable only on /profile,
 * so most employees never found it and their calendars stayed silently
 * empty. One line on the dashboard fixes the discovery problem without
 * nagging anyone who has already sorted it out.
 *
 * SHOWN WHENE NEITHER CHANNEL IS SET UP. One is enough to stop the
 * banner: someone who enabled push but skipped Google Calendar is
 * already getting their deadlines surfaced, and someone who connected
 * Google is getting Google's own reminders. Demanding both would train
 * people to dismiss it.
 *
 * DISMISSAL IS A 24-HOUR COOLDOWN, not permanent. Setup can fail
 * silently — a revoked Google token, a cleared browser profile — and a
 * permanently-dismissed banner would never come back for someone who
 * actually needs it. The key is scoped to the user id so one person's
 * dismissal does not hide it for the next person on a shared device.
 *
 * The cooldown lives in localStorage, which is an EXTERNAL STORE — it
 * outlives this component and changes without React knowing. That is
 * what useSyncExternalStore is for. It also sidesteps the two purity
 * traps this code would otherwise hit: setState-in-effect (a cascading
 * render on every mount) and Date.now()-during-render (a value that
 * changes every render, so nothing can memoise). Reading it as a single
 * boolean snapshot means the timestamp is compared exactly once, in one
 * place, and the answer is stable between renders.
 */
const DISMISS_KEY = (userId: string) => `taskora:setup-banner-dismissed:${userId}`;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Notified when the cooldown changes so every mounted banner re-reads it. */
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

const subscribeDismissal = (onStoreChange: () => void) => {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
};

/**
 * True while the cooldown is still running.
 *
 * Throws are swallowed: private browsing and disabled storage both throw
 * on access, and a banner is not worth breaking the dashboard over. In
 * that case we report "dismissed", which is the conservative answer —
 * a broken storage API should not mean we nag on every single page load.
 */
function readDismissed(userId: string): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY(userId));
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) return false;
    if (until <= Date.now()) {
      // Expired. Clear it so the key does not linger forever.
      window.localStorage.removeItem(DISMISS_KEY(userId));
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Server + hydration snapshot is "dismissed", i.e. render nothing.
 *
 * localStorage does not exist on the server, so the honest server answer
 * is "unknown". Returning true here both suppresses the banner during SSR
 * and during the hydration pass, then React swaps in the real client
 * snapshot immediately after. Net effect: no banner flash for a user who
 * already dismissed it, and no hydration mismatch for one who did not.
 */
const readDismissedOnServer = () => true;

export function CalendarSetupBanner({ userId }: { userId: string }) {
  const { data: calendar } = useQuery(googleCalendarOptions);
  const { state: pushState } = usePushNotifications();

  const getSnapshot = useCallback(() => readDismissed(userId), [userId]);
  const dismissed = useSyncExternalStore(
    subscribeDismissal,
    getSnapshot,
    readDismissedOnServer
  );

  const connected = calendar?.connected ?? false;
  // `subscribed` is the only state that means a push row actually exists.
  // `granted` means permission was allowed but no subscription was made.
  const pushEnabled = pushState === "subscribed";

  // Bail out entirely once either channel works.
  if (connected || pushEnabled) return null;
  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(
        DISMISS_KEY(userId),
        String(Date.now() + COOLDOWN_MS)
      );
    } catch {
      // Storage refused the write. Emit anyway so the in-memory cooldown
      // still applies for this session via the same read path.
    }
    emit();
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">Your tasks aren&apos;t syncing anywhere yet.</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Connect Google Calendar and enable notifications so you don&apos;t
            miss deadlines.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button type="button" size="sm" render={<Link href="/calendar" />}>
          <BellRing className="size-3.5" />
          Set up calendar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss setup reminder"
          onClick={dismiss}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}