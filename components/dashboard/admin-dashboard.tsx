"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  AlertTriangle,
  Eye,
  Plus,
  MessageSquare,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { StatusDot } from "@/components/shared/status-dot";
import { adminDashboardOptions } from "@/lib/queries/options";
import { getRecentActivity } from "@/lib/actions/activity";
import { formatActivityText } from "@/lib/activity-format";
import {
  getGreeting,
  getRelativeTime,
  isOverdue,
  cn,
} from "@/lib/utils";
import type { ActivityItem } from "@/lib/actions/activity";

interface AdminDashboardProps {
  firstName: string;
}

/**
 * §9 — cached dashboard. One query key; task/comment/payment events
 * invalidate it via the session RealtimeProvider only while it's
 * mounted. Navigating away and back serves cache, not a refetch.
 */
export function AdminDashboard({ firstName: _firstName }: AdminDashboardProps) {
  const { data, isLoading } = useQuery(adminDashboardOptions);
  const activityQuery = useQuery({
    queryKey: ["activity", "recent", 8] as const,
    queryFn: async () => {
      const res = await getRecentActivity(8);
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load activity");
      return res.data as ActivityItem[];
    },
    staleTime: 30_000,
  });
  const activity = activityQuery.data ?? [];

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonList rows={4} />
      </div>
    );
  }

  const counters = [
    { label: "Due today", value: data.counts.due_today, href: "/tasks", tone: "text-foreground" },
    { label: "Needs review", value: data.counts.needs_review, href: "/tasks?status=SUBMITTED", tone: "text-violet-600 dark:text-violet-400" },
    { label: "Overdue", value: data.counts.overdue, href: "/tasks", tone: "text-destructive" },
  ];

  return (
    <div className="space-y-8">
      {/* Header + quick actions (§63) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {getGreeting()}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what needs your attention today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/clients/new" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>
            <Plus className="size-4" /> Client
          </Link>
          <Link href="/projects/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Plus className="size-4" /> Project
          </Link>
          <Link href="/tasks/new">
            <Button size="sm">
              <Plus className="size-4" /> New task
            </Button>
          </Link>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-3">
        {counters.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-xl border bg-card px-4 py-3.5 transition-colors hover:bg-accent/50"
          >
            <p className={cn("text-2xl font-semibold tabular-nums", c.tone)}>
              {c.value}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.label}</p>
          </Link>
        ))}
      </div>

      {/* Needs attention */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Needs attention</h2>
        {data.needs_attention.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing waiting on you. Nice.
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {data.needs_attention.map((item) => (
              <Link
                key={item.id}
                href={`/tasks/${item.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    item.kind === "SUBMITTED"
                      ? "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"
                      : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                  )}
                >
                  {item.kind === "SUBMITTED" ? (
                    <Eye className="size-4" />
                  ) : (
                    <AlertTriangle className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {item.subtitle}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.kind === "SUBMITTED" && item.created_at
                    ? getRelativeTime(item.created_at)
                    : item.deadline
                      ? getRelativeTime(item.deadline)
                      : ""}
                </span>
                <span className="hidden shrink-0 sm:block">
                  <Button size="sm" variant="outline">
                    {item.kind === "SUBMITTED" ? "Review" : "Open"}
                  </Button>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Today's work */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Today&apos;s work</h2>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            All tasks <ArrowRight className="size-3" />
          </Link>
        </div>
        {data.todays_work.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            <Clock className="mr-1.5 inline size-3.5" />
            No deadlines today.
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {data.todays_work.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {t.project_name}
                    {t.assigned_name ? ` · ${t.assigned_name}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    t.deadline && isOverdue(t.deadline)
                      ? "font-medium text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {t.deadline ? getRelativeTime(t.deadline) : "No deadline"}
                </span>
                {t.status && <StatusDot status={t.status as never} className="hidden sm:inline-flex" />}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent activity — real event stream (§30) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Activity will appear here as your team works.
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {activity.map((item) => (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MessageSquare className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {formatActivityText(item.actor_name, item.type, item.detail, item.task_title)}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {getRelativeTime(item.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
