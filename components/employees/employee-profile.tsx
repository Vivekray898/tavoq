"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { StatusDot } from "@/components/shared/status-dot";
import { getEmployeeProfile } from "@/lib/actions/employees";
import {
  formatCurrency,
  formatDate,
  formatDeadline,
  getInitials,
} from "@/lib/utils";
import type { TaskStatus } from "@/types/database";

export function EmployeeProfile({ employeeId }: { employeeId: string }) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getEmployeeProfile>
  >["data"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await getEmployeeProfile(employeeId);
      if (result.success && result.data) setData(result.data);
      setLoading(false);
    })();
  }, [employeeId]);

  if (loading) return <SkeletonPage />;
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-lg font-semibold">Employee not found</h2>
        <Link href="/employees" className="mt-6">
          <Button variant="outline">Back to employees</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {/* Back */}
      <div className="mb-3">
        <Link
          href="/employees"
          className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-accent"
          aria-label="Back to employees"
        >
          <ArrowLeft className="size-4.5" />
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-lg">
            {getInitials(data.full_name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {data.full_name}
          </h1>
          <a
            href={`mailto:${data.email}`}
            className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            <Mail className="size-3.5" />
            {data.email}
          </a>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-8 grid max-w-lg grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card px-4 py-3.5 text-center">
          <p className="text-2xl font-semibold tabular-nums">
            {data.active_tasks.length}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Active tasks</p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3.5 text-center">
          <p className="text-2xl font-semibold tabular-nums">
            {data.completed_count}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Done this month</p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3.5 text-center">
          <p className="text-2xl font-semibold tabular-nums">
            {formatCurrency(data.pending_payout)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Pending pay</p>
        </div>
      </div>

      {/* Active tasks */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Active tasks</h2>
        {data.active_tasks.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No active tasks right now.
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {data.active_tasks.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {t.project_name}
                    {t.deadline ? ` · ${formatDeadline(t.deadline)}` : ""}
                  </p>
                </div>
                <StatusDot status={t.status as TaskStatus} className="shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent work */}
      {data.recent_work.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Recent completed work</h2>
          <div className="divide-y rounded-xl border bg-card">
            {data.recent_work.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  {t.completed_at && (
                    <p className="text-[13px] text-muted-foreground">
                      Completed {formatDate(t.completed_at)}
                    </p>
                  )}
                </div>
                <StatusDot status="COMPLETED" className="shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
