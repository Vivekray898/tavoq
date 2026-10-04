"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { googleCalendarOptions } from "@/lib/queries/options";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  syncAllTasksToCalendar,
  setupWatchChannel,
} from "@/lib/actions/google-calendar";

/**
 * Google Calendar connection panel.
 *
 * Lives on the profile page. "Connect" asks the server for an OAuth
 * URL and sends the browser to Google; the callback route does the
 * token exchange and redirects back here with ?gcal=connected, which we
 * turn into a toast.
 */
export function GoogleCalendarConnect() {
  const queryClient = useQueryClient();
  const [working, setWorking] = useState<"connect" | "sync" | "disconnect" | null>(null);

  const { data, isLoading } = useQuery(googleCalendarOptions);

  // Phase 3: a revoked grant is NOT the same as never having connected.
  // Both read as "connected: false", so without the explicit state the UI
  // would show a first-time connect screen to a user whose access simply
  // expired — and the existing "Connect" button would read as an
  // invitation rather than a repair.
  const needsReconnect = data?.state === "needs_reconnect";

  // Surface the OAuth result once, on mount, then clean the URL.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("gcal");
    if (!result) return;

    if (result === "connected") {
      toast.success("Google Calendar connected");
    } else if (result === "denied") {
      toast.error("Google Calendar connection cancelled");
    } else if (result === "unauthorized") {
      toast.error("Please sign in again to finish connecting Google Calendar");
    } else if (result === "error") {
      toast.error("Couldn't connect Google Calendar. Try again.");
    } else if (result === "invalid") {
      toast.error("That connection request expired. Try again.");
    } else if (result === "no_refresh_token") {
      toast.error(
        "Google didn't return a refresh token. Revoke Taskora's calendar access at myaccount.google.com, then reconnect."
      );
    }

    // Strip the flag so a refresh doesn't re-toast.
    window.history.replaceState({}, "", window.location.pathname);
    void queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });
  }, [queryClient]);

  async function handleConnect() {
    setWorking("connect");
    const result = await connectGoogleCalendar();
    setWorking(null);
    if (result.success && result.data) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error ?? "Couldn't start the connection");
    }
  }

  async function handleSync() {
    setWorking("sync");
    // Always the full sync. It is idempotent — a task that already has
    // an event id is PUT, one without is POSTed — so it is the only
    // path that can create a missing event.
    //
    // This used to branch on `lastSyncedAt` and fall through to the
    // incremental path, which only ever processes deletions the user
    // made in Google. That made "Sync now" report "already up to date"
    // no matter what, including after newly assigned tasks were added.
    const result = await syncAllTasksToCalendar();
    setWorking(null);

    if (result.success && result.data) {
      const { created, updated, removed, errors } = result.data;

      // A per-task Google failure is collected rather than thrown, so
      // reporting only the totals would show a successful sync over a
      // list where every single insert failed.
      if (errors.length > 0) {
        toast.error(
          `Synced with ${errors.length} error${errors.length === 1 ? "" : "s"} — ${errors[0]}`
        );
      } else {
        toast.success(
          created + updated + removed === 0
            ? "Calendar is already up to date"
            : `Synced — ${created} added, ${updated} updated${
                removed ? `, ${removed} removed` : ""
              }`
        );
      }

      await queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });
    } else {
      toast.error(result.error ?? "Couldn't sync with Google Calendar");
    }
  }

  async function handleDisconnect() {
    setWorking("disconnect");
    const result = await disconnectGoogleCalendar();
    setWorking(null);
    if (result.success) {
      toast.success("Google Calendar disconnected");
      await queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });
    } else {
      toast.error(result.error ?? "Couldn't disconnect Google Calendar");
    }
  }

  // Renew the push channel (Google caps them at 7 days).
  async function handleWatch() {
    const result = await setupWatchChannel();
    if (!result.success) {
      toast.error(result.error ?? "Couldn't watch the calendar for changes");
    }
  }

  const connected = !!data?.connected;

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <CalendarDays className="size-4" /> Google Calendar
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {needsReconnect
          ? "Google access expired or was revoked. Reconnect to resume syncing your tasks."
          : connected
            ? "Your assigned tasks are kept in sync with your Google Calendar."
            : "Connect your Google account to see your assigned tasks on your calendar."}
      </p>

      <div className="divide-y rounded-xl border bg-card">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-3.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking connection…
          </div>
        ) : connected ? (
          <>
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{data?.googleEmail}</p>
                <p className="text-xs text-muted-foreground">
                  {data?.syncedTaskCount ?? 0} task
                  {(data?.syncedTaskCount ?? 0) === 1 ? "" : "s"} synced
                  {data?.lastSyncedAt
                    ? ` · last synced ${formatDate(data.lastSyncedAt)}`
                    : " · not synced yet"}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSync}
                disabled={working !== null}
              >
                {working === "sync" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Sync now
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <p className="text-xs text-muted-foreground">
                Only Taskora manages these events — editing them in Google won&apos;t change your
                tasks.
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleWatch}
                  disabled={working !== null}
                >
                  Watch for changes
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={working !== null}
                >
                  {working === "disconnect" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unlink className="size-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {needsReconnect
                  ? "Your Google authorisation is no longer valid, so nothing is syncing right now."
                  : "We only ever create and update your own task events."}
              </p>
              {needsReconnect && data?.googleEmail && (
                <p className="truncate text-[11px] text-muted-foreground">
                  Last connected as {data.googleEmail}
                </p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleConnect}
              disabled={working !== null}
              className="shrink-0"
            >
              {working === "connect" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarDays className="size-4" />
              )}
              {needsReconnect ? "Reconnect" : "Connect"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
