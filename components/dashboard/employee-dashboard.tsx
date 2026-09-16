"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskCard } from "@/components/tasks/task-card";
import { createClient } from "@/lib/supabase/client";
import {
  getEmployeeDashboard,
  type EmployeeDashboardData,
} from "@/lib/actions/dashboard";
import { getGreeting, getRelativeTime } from "@/lib/utils";

interface EmployeeDashboardProps {
  firstName: string;
}

export function EmployeeDashboard({ firstName }: EmployeeDashboardProps) {
  const [data, setData] = useState<EmployeeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const result = await getEmployeeDashboard();
      if (result.success && result.data) setData(result.data);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Realtime: my tasks change → refresh (scoped to assigned_to = me)
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 500);
    };

    const channel = supabase
      .channel("employee-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        schedule
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        schedule
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonList rows={4} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header (§10): what do I need to do? */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {getGreeting()}, {firstName} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.due_today_count > 0
            ? `You have ${data.due_today_count} task${data.due_today_count !== 1 ? "s" : ""} due today.`
            : data.upcoming.length > 0
              ? "Nothing due today — here's what's coming up."
              : "You're all caught up."}
        </p>
      </div>

      {/* Due today */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Due today</h2>
        {data.due_today.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mr-1.5 inline size-4 text-emerald-500" />
            Nothing due today. Nice work!
          </p>
        ) : (
          <div className="space-y-2.5">
            {data.due_today.map((t) => (
              <TaskCard
                key={t.id}
                href={`/tasks/${t.id}`}
                title={t.title}
                projectName={t.project_name}
                status={t.status as never}
                priority={t.priority}
                deadline={t.deadline}
                payoutAmount={t.payout_amount}
                paymentStatus={t.payment_status}
              />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming */}
      {data.upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Upcoming</h2>
          <div className="space-y-2.5">
            {data.upcoming.map((t) => (
              <TaskCard
                key={t.id}
                href={`/tasks/${t.id}`}
                title={t.title}
                projectName={t.project_name}
                status={t.status as never}
                priority={t.priority}
                deadline={t.deadline}
                payoutAmount={t.payout_amount}
                compact
              />
            ))}
          </div>
        </section>
      )}

      {/* Waiting for review */}
      {data.waiting_review.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Waiting for review
          </h2>
          <div className="divide-y rounded-xl border bg-card">
            {data.waiting_review.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <Clock className="size-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {t.project_name}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.submitted_at ? `Submitted ${getRelativeTime(t.submitted_at)}` : "Submitted"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recently completed */}
      {data.recently_completed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Recently completed
          </h2>
          <div className="divide-y rounded-xl border bg-card">
            {data.recently_completed.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.payment_status === "PAID"
                    ? "Paid"
                    : t.payout_amount > 0
                      ? "Payment pending"
                      : t.completed_at
                        ? getRelativeTime(t.completed_at)
                        : ""}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.due_today.length === 0 &&
        data.upcoming.length === 0 &&
        data.waiting_review.length === 0 && (
          <EmptyState
            title="You're all caught up 🎉"
            description="No pending work right now. New assignments will show up here."
            icon={<CheckCircle2 />}
          />
        )}

      {/* Quick link to all tasks */}
      <div className="flex justify-center pb-2">
        <Link href="/tasks">
          <Button variant="outline" size="sm">
            View all my tasks <ArrowRight className="size-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
