"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { PushPermissionCard } from "@/components/notifications/push-permission-card";
import { googleCalendarOptions } from "@/lib/queries/options";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  syncAllTasksToCalendar,
} from "@/lib/actions/google-calendar";
import { formatRelativeTime, cn } from "@/lib/utils";
import type { Task } from "@/types/database";

/**
 * §71 — Calendar & notifications, out of the profile page.
 *
 * Connecting Google Calendar was buried under /profile, where nobody
 * looked; employees consequently never connected and their calendars
 * silently stayed empty. This page is now the obvious place to find it,
 * and it shows something useful even before connecting: a month of the
 * deadlines the user already has.
 *
 * Push lives here for the same reason — it is the other half of "don't
 * miss a deadline", and both cards describe the same promise.
 */
export function CalendarView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(googleCalendarOptions);
  const [working, setWorking] = useState<"connect" | "sync" | "disconnect" | null>(null);

  // Surface the OAuth result once, on mount, then clean the URL. The
  // callback route redirects here with ?gcal=connected, and without this
  // the connect would appear to do nothing at all.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("gcal");
    if (!result) return;

    if (result === "connected") {
      toast.success("Google Calendar connected");
      // The connection was written server-side after this page's query
      // was already in flight, so refetch rather than wait for a stale
      // cached answer.
      void queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });
    } else if (result === "denied") {
      toast.error("Google Calendar connection cancelled");
    } else if (result === "unauthorized") {
      toast.error("Google rejected that account. Try a personal Google account.");
    } else if (result === "error") {
      toast.error("Couldn't connect Google Calendar. Please try again.");
    }

    params.delete("gcal");
    const next = `${window.location.pathname}${params.toString()}${
      params.toString() ? "?" : ""
    }`;
    window.history.replaceState({}, "", next || "/calendar");
  }, [queryClient]);

  async function handleConnect() {
    setWorking("connect");
    const res = await connectGoogleCalendar();
    if (res.success && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    setWorking(null);
    toast.error(res.error ?? "Couldn't start the Google connection");
  }

  async function handleSync() {
    setWorking("sync");
    const res = await syncAllTasksToCalendar();
    setWorking(null);
    // Invalidate on BOTH outcomes. A revoked grant makes the server
    // delete the token row, so the cached status is now wrong — keeping
    // it would keep showing "connected" and hide the dashboard banner
    // that would otherwise prompt a reconnect.
    void queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });
    if (res.success && res.data) {
      const { created, updated, removed, errors } = res.data;
      if (errors.length > 0) {
        toast.error(
          `Sync completed with ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}`
        );
      } else if (created + updated + removed === 0) {
        toast.success("Calendar is already up to date");
      } else {
        toast.success(
          `Calendar up to date — ${created} added, ${updated} updated, ${removed} removed`
        );
      }
    } else {
      toast.error(res.error ?? "Sync failed");
    }
  }

  async function handleDisconnect() {
    setWorking("disconnect");
    const res = await disconnectGoogleCalendar();
    setWorking(null);
    if (res.success) {
      void queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });
      toast.success("Google Calendar disconnected");
    } else {
      toast.error(res.error ?? "Couldn't disconnect");
    }
  }

  const connected = data?.connected ?? false;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep your assigned deadlines on Google Calendar, and get a buzz when they move.
        </p>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          {/* ── Google Calendar ─────────────────────────────── */}
          <section className="space-y-2">
            {connected ? (
              <div className="rounded-xl border bg-card px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <CalendarDays className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        Google Calendar
                        <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                          <Check className="size-3" /> Connected
                        </Badge>
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                        {data?.googleEmail ?? "Connected account"}
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {data?.syncedTaskCount ?? 0} task
                        {(data?.syncedTaskCount ?? 0) === 1 ? "" : "s"} synced
                        {data?.lastSyncedAt
                          ? ` · last synced ${formatRelativeTime(data.lastSyncedAt)}`
                          : " · never synced"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSync}
                      disabled={working !== null}
                    >
                      {working === "sync" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Sync now
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDisconnect}
                      disabled={working !== null}
                    >
                      {working === "disconnect" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Unlink className="size-3.5" />
                      )}
                      Disconnect
                    </Button>
                  </div>
                </div>
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Tasks sync automatically when they&apos;re assigned, edited, or
                  completed. Sync now only re-checks for drift.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border bg-card px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <CalendarDays className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">Google Calendar</p>
                      <p className="mt-0.5 max-w-prose text-[13px] text-muted-foreground">
                        Connect once and your assigned tasks appear on your Google
                        Calendar automatically. Due-date reminders are handled by
                        Google.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0"
                    onClick={handleConnect}
                    disabled={working !== null}
                  >
                    {working === "connect" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="size-3.5" />
                    )}
                    Connect Google Calendar
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* ── Deadline preview ─────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Your upcoming deadlines</h2>
            <DeadlinePreview />
          </section>

          {/* ── Push ─────────────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <p className="text-[13px] text-muted-foreground">
              Get a buzz on your phone the moment a task is assigned or a
              deadline is coming up.
            </p>
            <PushPermissionCard />
          </section>

          {/* ── Email fallback ───────────────────────────────── */}
          <section className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3.5">
            <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">
              We&apos;ll still send a daily digest if you prefer email. Push
              notifications are faster, and they work when Taskora is closed.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * A month grid of the user's own unfinished task deadlines.
 *
 * Deliberately read-only and scoped to the viewer: the point is to show
 * that there IS something to sync, not to become a second task manager.
 * Deadlines come from the shared tasks cache, so this costs no extra
 * request when the dashboard has already loaded.
 */
function DeadlinePreview() {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["myTasks"],
    queryFn: async () => {
      const { getTasks } = await import("@/lib/actions/tasks");
      const res = await getTasks();
      if (!res.success || !res.data) throw new Error("Failed to load your tasks");
      return res.data;
    },
    staleTime: 60_000,
  });

  const { month, byDay } = useMemo(() => {
    const now = new Date();
    const map = new Map<string, Task[]>();
    for (const task of tasks ?? []) {
      if (!task.deadline) continue;
      if (task.status === "COMPLETED") continue;
      const key = new Date(task.deadline).toISOString().slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return { month: new Date(now.getFullYear(), now.getMonth(), 1), byDay: map };
  }, [tasks]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const total = useMemo(() => {
    let n = 0;
    for (const list of byDay.values()) n += list.length;
    return n;
  }, [byDay]);

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <p className="text-sm font-medium">
          {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </p>
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? "No dated deadlines this month"
            : `${total} task${total === 1 ? "" : "s"} with a deadline`}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-7 gap-1" aria-hidden>
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md bg-muted/60" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">{monthCells(month, byDay, todayKey)}</div>
      )}

      {/* The list below the grid is what makes the dots legible — a dot
          alone tells the user nothing about which task it is. */}
      {total > 0 ? (
        <ul className="divide-y border-t pt-1">
          {[...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, 4)
            .flatMap(([date, list]) =>
              list.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex items-center justify-between gap-3 px-1 py-2 text-[13px] transition-colors hover:bg-accent/50"
                  >
                    <span className="truncate">{task.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {new Date(date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </Link>
                </li>
              ))
            )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The month's day cells, Monday-first.
 *
 * Extracted so the grid renders from one computation rather than an
 * inline IIFE, which keeps the component readable and makes the
 * padding/tail rules explicit in one place.
 */
function monthCells(
  month: Date,
  byDay: Map<string, Task[]>,
  todayKey: string
) {
  const leading = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate();

  return Array.from({ length: leading + daysInMonth }, (_, idx) => {
    if (idx < leading) {
      return <div key={`pad-${idx}`} className="aspect-square" />;
    }
    const day = idx - leading + 1;
    const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(day).padStart(2, "0")}`;
    const dayTasks = byDay.get(date) ?? [];
    const isToday = date === todayKey;
    const isPast = date < todayKey && dayTasks.length > 0;
    return (
      <div
        key={date}
        className={cn(
          "relative flex aspect-square flex-col items-center justify-center rounded-md border text-xs",
          dayTasks.length > 0 ? "border-border bg-muted/50" : "border-transparent",
          isToday && "ring-1 ring-ring"
        )}
      >
        <span className={cn(dayTasks.length > 0 && "font-semibold")}>{day}</span>
        {dayTasks.length > 0 ? (
          <span
            className={cn(
              "absolute bottom-1 size-1 rounded-full",
              isPast ? "bg-destructive" : "bg-primary"
            )}
          />
        ) : null}
      </div>
    );
  });
}
