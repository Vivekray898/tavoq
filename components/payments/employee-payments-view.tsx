"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { myEarningsOptions } from "@/lib/queries/options";
import { formatCurrency, cn } from "@/lib/utils";
import type { PaymentItem } from "@/lib/actions/payments";

/**
 * §12 — employee earnings, mobile-first. Shows BOTH payment kinds
 * (task-based with task/project context and custom payments with
 * their description), sourced from the payments table only.
 * Each viewed week is its own cache entry, so paging between weeks
 * never refetches (§3).
 */
export function EmployeePaymentsView() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [detail, setDetail] = useState<PaymentItem | null>(null);

  const { data, isLoading, isError } = useQuery(myEarningsOptions(weekOffset));

  const isCurrentWeek = weekOffset === 0;
  const weekLabel = (() => {
    if (!data) return "";
    const start = new Date(data.weekStart);
    const end = new Date(new Date(data.weekEnd).getTime() - 24 * 60 * 60 * 1000);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return `${fmt(start)} – ${fmt(end)}`;
  })();

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">
          My earnings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Task payouts and custom payments recorded for you.
        </p>
      </div>

      {/* Summary (§26) */}
      {isLoading && !data ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Couldn&apos;t load your payments. Check your connection and try again.
        </div>
      ) : data ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatCurrency(data.totalPaid)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Total paid</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatCurrency(data.thisWeek)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">This week</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p
              className={cn(
                "text-2xl font-semibold tabular-nums tracking-tight",
                data.pending > 0 && "text-amber-600 dark:text-amber-400"
              )}
            >
              {formatCurrency(data.pending)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pending{data.pendingCount > 0 ? ` (${data.pendingCount})` : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* Week switcher (§65) */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setWeekOffset((w) => w - 1)}
          aria-label="Previous week"
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarDays className="size-4 text-muted-foreground" />
          {weekLabel}
          {isCurrentWeek && (
            <span className="text-xs font-normal text-muted-foreground">(current)</span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isCurrentWeek}
          onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
          aria-label="Next week"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Day groups (§27) */}
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : !data || data.days.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium">No payments this week</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Payments marked as paid will appear here on the day they were recorded.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.days.map((day) => (
            <section key={day.date}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold">{day.label}</h2>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                  {formatCurrency(day.total)}
                </span>
              </div>
              <div className="divide-y rounded-xl border bg-card">
                {day.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setDetail({
                        id: item.id,
                        kind: item.kind,
                        employee_id: null,
                        employee_name: null,
                        task_id: item.kind === "TASK" ? item.id : null,
                        label: item.label,
                        project_name: item.project_name,
                        amount: item.amount,
                        status: item.status,
                        paid_at: item.paid_at,
                        payment_note: item.payment_note,
                      })
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.label}
                        {item.kind === "CUSTOM" && (
                          <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Custom
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {item.project_name ?? (item.kind === "CUSTOM" ? "Custom payment" : "—")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatCurrency(item.amount)}
                      </p>
                      <p
                        className={cn(
                          "text-[11px] font-medium",
                          item.status === "PAID"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {item.status === "PAID" ? "Paid" : "Pending"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Pending payouts (shown regardless of the viewed week) */}
      {data && data.pending > 0 && isCurrentWeek && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          {formatCurrency(data.pending)} is awaiting payment across{" "}
          {data.pendingCount} payment{data.pendingCount !== 1 ? "s" : ""}. Once the
          admin marks them paid, they&apos;ll appear in your history.
        </p>
      )}

      {/* Payment detail (§29) */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.label}</DialogTitle>
            <DialogDescription>
              {detail?.project_name ??
                (detail?.kind === "CUSTOM" ? "Custom payment" : "Task payment")}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-semibold">{formatCurrency(detail.amount)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Status</dt>
                <dd
                  className={cn(
                    "font-medium",
                    detail.status === "PAID"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {detail.status === "PAID" ? "Paid" : "Pending"}
                </dd>
              </div>
              {detail.paid_at && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Paid on</dt>
                  <dd>
                    {new Date(detail.paid_at).toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
              )}
              {detail.payment_note && (
                <div>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd className="mt-1">{detail.payment_note}</dd>
                </div>
              )}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
