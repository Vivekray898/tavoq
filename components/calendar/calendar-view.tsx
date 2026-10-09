"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
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
import { googleCalendarOptions, taskListOptions } from "@/lib/queries/options";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  syncAllTasksToCalendar,
  type SyncResult,
} from "@/lib/actions/google-calendar";
import { formatRelativeTime, cn } from "@/lib/utils";
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from "@/lib/constants";
import { toCalendarDate } from "@/lib/google/calendar";
import type { TaskListItem } from "@/lib/actions/tasks";

/** Chips drawn inside one day cell before it collapses to "+N more". */
const MAX_CHIPS = 3;

/**
 * §71 — Calendar & notifications, out of the profile page.
 *
 * Connecting Google Calendar used to sit under /profile where nobody found
 * it, so employees never connected and their calendars stayed empty.
 *
 * The month grid below is a real calendar rather than a dot grid: deadlines
 * sit inside the day they belong to, so a person can see what a given day
 * holds without counting dots.
 */
export function CalendarView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(googleCalendarOptions);
  const [working, setWorking] = useState<"connect" | "sync" | "disconnect" | null>(null);
  // The last run's outcome, kept on screen. A toast is gone in a few
  // seconds, which is why "the result never showed up" was reported — the
  // card now carries the answer until the next sync.
  const [syncReport, setSyncReport] = useState<SyncResult | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("gcal");
    if (!result) return;

    if (result === "connected") {
      toast.success("Google Calendar connected");
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

    // Refetch on BOTH outcomes, and AWAIT it. The card reads its count from
    // calendar_events, which this action just wrote; not awaiting left the
    // previous numbers on screen, and a revoked grant additionally needs the
    // new "not connected" state to land. This sits BEFORE the branch on
    // success so a failure refetches too.
    await queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });

    if (res.success && res.data) {
      setSyncReport(res.data);
      reportSyncOutcome(res.data);
      return;
    }

    setSyncReport(null);
    toast.error(res.success ? "Calendar sync returned no result" : res.error ?? "Sync failed");
  }

  async function handleDisconnect() {
    setWorking("disconnect");
    const res = await disconnectGoogleCalendar();
    setWorking(null);
    if (res.success) {
      setSyncReport(null);
      await queryClient.invalidateQueries({ queryKey: googleCalendarOptions.queryKey });
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
                        {` · ${data?.eligibleTaskCount ?? 0} eligible`}
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
                      {data?.syncMode === "admin_assignment"
                        ? "Sync assigned work"
                        : "Sync my assigned tasks"}
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
                  {data?.syncMode === "admin_assignment"
                    ? "Work you assign syncs to your calendar automatically, as it is assigned, edited, or completed. This button only re-checks for drift."
                    : "Tasks sync automatically when they're assigned, edited, or completed. This button only re-checks for drift."}
                </p>

                {syncReport ? <SyncReport result={syncReport} /> : null}
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
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ExternalLink className="size-4" />
                    )}
                    Connect Google Calendar
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* ── Month view ───────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Your deadlines</h2>
            <MonthCalendar />
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
 * One sentence describing what a run actually did.
 *
 * Shared by the toast and the on-card report so the two can never disagree
 * about what happened.
 */
function describeOutcome(r: SyncResult): { tone: "error" | "info" | "success"; text: string } {
  const assigned = r.mode === "admin_assignment";
  const noun = assigned ? "assigned task" : "task";
  const plural = assigned ? "assigned tasks" : "tasks";

  if (r.errors.length > 0) {
    return {
      tone: "error",
      text: `${r.errors.length} ${r.errors.length === 1 ? noun : `${noun}s`} could not be synchronized — ${r.errors[0]}`,
    };
  }
  // Never "already up to date": nothing matched this calendar, which is a
  // different fact and the one that let the original bug read as success.
  if (r.eligibleTasks === 0) {
    return {
      tone: "info",
      text:
        `No eligible ${plural} were found for this calendar` +
        (r.rawTasksLoaded > 0 ? ` — ${r.rawTasksLoaded} checked, all completed or without a deadline.` : "."),
    };
  }
  if (r.created + r.updated + r.removed === 0) {
    return {
      tone: "success",
      text: `Calendar is already up to date — ${r.eligibleTasks} ${r.eligibleTasks === 1 ? "task" : "tasks"} checked.`,
    };
  }
  return {
    tone: "success",
    text:
      `${r.created} ${r.created === 1 ? noun : `${noun}s`} added to Google Calendar` +
      (r.updated ? `, ${r.updated} updated` : "") +
      (r.removed ? `, ${r.removed} removed` : "") +
      ".",
  };
}

function reportSyncOutcome(r: SyncResult) {
  const { tone, text } = describeOutcome(r);
  if (tone === "error") toast.error(text);
  else if (tone === "info") toast.info(text);
  else toast.success(text);
}

/**
 * The last run's outcome, on screen rather than in a toast.
 *
 * The counter row matters as much as the headline: it is what makes a zero
 * explicable instead of mysterious.
 */
function SyncReport({ result }: { result: SyncResult }) {
  const { tone, text } = describeOutcome(result);
  return (
    <div className="mt-3 border-t pt-3">
      <p className={cn("text-[13px]", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
        {text}
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground tabular-nums">
        {result.rawTasksLoaded} checked · {result.eligibleTasks} eligible ·{" "}
        {result.alreadyMapped} already on the calendar · {result.skippedCompleted} completed ·{" "}
        {result.skippedMissingDeadline} without a deadline
      </p>
    </div>
  );
}

/** Local YYYY-MM-DD. Never toISOString(), which shifts by timezone. */
function ymdKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Parse "2026-10" into the local first of that month. */
function monthStart(monthKey: string): Date {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1);
}

/**
 * Every cell of the displayed month, padded to whole Monday-first weeks.
 *
 * Always 42 cells (6 rows). A five-week month renders one empty row rather
 * than reflowing, so the grid does not change height as the user pages
 * through months — the same reason Google Calendar holds a fixed six rows.
 */
function monthCells(monthKey: string): { dateKey: string; day: number; inMonth: boolean }[] {
  const first = monthStart(monthKey);
  const leading = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(first);
  start.setDate(first.getDate() - leading);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return {
      dateKey: ymdKey(d),
      day: d.getDate(),
      inMonth: d.getMonth() === first.getMonth(),
    };
  });
}

/**
 * A Google Calendar–shaped month view over the user's own tasks.
 *
 * Reuses `taskListOptions` — the same query and cache key as the task list —
 * so the grid cannot drift from what RLS already permits this user to see,
 * and a task mutation invalidates both at once. It previously used its own
 * `["myTasks"]` key, which nothing in the app ever invalidated, so the grid
 * served stale tasks long after an edit.
 */
function MonthCalendar() {
  const { data: tasks, isLoading } = useQuery(taskListOptions);

  // Today in the app's calendar timezone. `new Date().toISOString()` reads as
  // yesterday for anyone east of Greenwich after 18:30.
  const todayKey = useMemo(() => toCalendarDate(new Date()), []);
  const [monthKey, setMonthKey] = useState(() => todayKey.slice(0, 7));
  const [selected, setSelected] = useState(todayKey);

  const byDay = useMemo(() => {
    const map = new Map<string, TaskListItem[]>();
    for (const task of tasks ?? []) {
      if (!task.deadline) continue;
      // The same helper the Google event body uses, so a deadline typed as
      // 7 Oct lands on 7 Oct here AND on 7 Oct there. Slicing the ISO string
      // instead moved IST deadlines back a day.
      const key = toCalendarDate(new Date(task.deadline));
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return map;
  }, [tasks]);

  const cells = useMemo(() => monthCells(monthKey), [monthKey]);
  const selectedTasks = byDay.get(selected) ?? [];

  // Paging moves the selection to the 1st so the detail panel always
  // describes a day that is actually visible in the grid.
  function shiftMonth(delta: number) {
    const d = monthStart(monthKey);
    d.setMonth(d.getMonth() + delta);
    const next = ymdKey(d).slice(0, 7);
    setMonthKey(next);
    setSelected(`${next}-01`);
  }

  function goToday() {
    setMonthKey(todayKey.slice(0, 7));
    setSelected(todayKey);
  }

  const title = monthStart(monthKey).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3">
      {/* ── Navigation ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
          <p className="ml-1 text-sm font-medium">{title}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={goToday}>
          Today
        </Button>
      </div>

      {/* ── Weekday header ─────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* ── Grid ───────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-7 gap-1" aria-hidden>
          {Array.from({ length: 42 }).map((_, i) => (
            <div key={i} className="min-h-[92px] animate-pulse rounded-md bg-muted/60" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1" role="grid" aria-label={title}>
          {cells.map((cell) => {
            const dayTasks = byDay.get(cell.dateKey) ?? [];
            const isToday = cell.dateKey === todayKey;
            const isSelected = cell.dateKey === selected;
            const isPast = cell.dateKey < todayKey;
            const overflow = dayTasks.length - MAX_CHIPS;

            return (
              <div
                key={cell.dateKey}
                role="gridcell"
                aria-selected={isSelected}
                aria-label={`${formatDayLabel(cell.dateKey)}, ${
                  dayTasks.length === 1 ? "1 task" : `${dayTasks.length} tasks`
                }`}
                tabIndex={0}
                onClick={() => setSelected(cell.dateKey)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(cell.dateKey);
                  }
                }}
                className={cn(
                  "flex min-h-[92px] cursor-pointer flex-col gap-1 rounded-md border p-1 text-left transition-colors",
                  cell.inMonth ? "bg-card" : "bg-muted/20",
                  !cell.inMonth && "opacity-50",
                  isSelected
                    ? "border-ring ring-1 ring-ring"
                    : isToday
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent/40",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums",
                    isToday && "bg-primary font-semibold text-primary-foreground"
                  )}
                >
                  {cell.day}
                </span>

                {dayTasks.slice(0, MAX_CHIPS).map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title={`${task.title} — ${TASK_STATUS_LABELS[task.status]}`}
                    aria-label={`${task.title}, ${TASK_STATUS_LABELS[task.status]}, due ${formatDayLabel(cell.dateKey)}`}
                    className={cn(
                      "block truncate rounded px-1 py-0.5 text-[10px] leading-tight font-medium",
                      TASK_STATUS_COLORS[task.status],
                      task.status === "COMPLETED" && "line-through opacity-70",
                      isPast && task.status !== "COMPLETED" && "ring-1 ring-destructive/40"
                    )}
                  >
                    {task.title}
                  </Link>
                ))}

                {overflow > 0 ? (
                  <span className="px-1 text-[10px] text-muted-foreground">+{overflow} more</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Selected day detail ────────────────────────────── */}
      <div className="border-t pt-2">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <p className="text-sm font-medium">{formatDayLabel(selected, true)}</p>
          <p className="text-xs text-muted-foreground">
            {selectedTasks.length === 0
              ? "No tasks on this day."
              : `${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {selectedTasks.length > 0 ? (
          <ul className="mt-1 divide-y">
            {selectedTasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  className="flex items-center justify-between gap-3 px-1 py-2 text-[13px] transition-colors hover:bg-accent/50"
                >
                  <span
                    className={cn(
                      "truncate",
                      task.status === "COMPLETED" && "text-muted-foreground line-through"
                    )}
                  >
                    {task.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {TASK_STATUS_LABELS[task.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "3 Oct", or "Saturday, 3 October 2026".
 *
 * Parsed as LOCAL noon rather than midnight: at midnight a DST boundary can
 * push the formatted date onto the neighbouring day.
 */
function formatDayLabel(dateKey: string, long = false): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1, 12);
  return date.toLocaleDateString("en-IN", {
    ...(long ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: long ? ("long" as const) : ("short" as const),
    ...(long ? { year: "numeric" as const } : {}),
  });
}
