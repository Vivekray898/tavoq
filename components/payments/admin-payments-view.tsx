"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import {
  markPaymentsPaidBatch,
  type AdminPaymentsData,
} from "@/lib/actions/payments";
import { adminPaymentsOptions } from "@/lib/queries/options";
import { formatCurrency, formatDate, getRelativeTime, cn } from "@/lib/utils";

type PaymentsTab = "pending" | "paid" | "employees";

interface EmployeeSummary {
  id: string;
  name: string;
  pending: number;
  pendingCount: number;
  paidTotal: number;
  paidThisWeek: number;
  paidThisMonth: number;
  payments: AdminPaymentsData["paid"];
}

/**
 * §30–37 — lightweight payout management workspace. Cached via
 * ['payments','admin']; realtime payment events invalidate it only
 * while this view is mounted.
 */
export function AdminPaymentsView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(adminPaymentsOptions);

  const [tab, setTab] = useState<PaymentsTab>("pending");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState("");
  const [marking, setMarking] = useState(false);
  const [drilldown, setDrilldown] = useState<EmployeeSummary | null>(null);

  // Per-employee rollup
  const employees = useMemo<EmployeeSummary[]>(() => {
    if (!data) return [];
    const map = new Map<string, EmployeeSummary>();

    const weekStart = (() => {
      const now = new Date();
      const day = (now.getDay() + 6) % 7;
      const d = new Date(now);
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();
    const monthStart = (() => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    })();

    for (const p of data.pending) {
      const key = p.employee_id || "unassigned";
      const entry = map.get(key) ?? {
        id: key,
        name: p.employee_name,
        pending: 0,
        pendingCount: 0,
        paidTotal: 0,
        paidThisWeek: 0,
        paidThisMonth: 0,
        payments: [],
      };
      entry.pending += p.amount;
      entry.pendingCount += 1;
      map.set(key, entry);
    }
    for (const p of data.paid) {
      const key = p.employee_id || "unassigned";
      const entry = map.get(key) ?? {
        id: key,
        name: p.employee_name ?? "Unknown",
        pending: 0,
        pendingCount: 0,
        paidTotal: 0,
        paidThisWeek: 0,
        paidThisMonth: 0,
        payments: [],
      };
      entry.paidTotal += p.amount;
      if (p.paid_at) {
        if (p.paid_at >= weekStart) entry.paidThisWeek += p.amount;
        if (p.paid_at >= monthStart) entry.paidThisMonth += p.amount;
      }
      entry.payments.push(p);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [data]);

  const filteredPaid = useMemo(() => {
    if (!data) return [];
    return employeeFilter === "all"
      ? data.paid
      : data.paid.filter((p) => p.employee_id === employeeFilter);
  }, [data, employeeFilter]);

  const selectedTotal = useMemo(() => {
    if (!data) return 0;
    return data.pending
      .filter((t) => selected.has(t.task_id))
      .reduce((sum, t) => sum + t.amount, 0);
  }, [data, selected]);

  function toggle(taskId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function handleBulkPaid() {
    setMarking(true);
    const result = await markPaymentsPaidBatch(Array.from(selected), note.trim() || undefined);
    setMarking(false);
    if (result.success && result.data) {
      const d = result.data;
      toast.success(
        `${d.marked} payment${d.marked !== 1 ? "s" : ""} marked as paid — ${formatCurrency(d.totalAmount)}`,
        {
          description: d.byEmployee
            .map((e) => `${e.name}: ${formatCurrency(e.amount)}`)
            .join(" · "),
        }
      );
      setSelected(new Set());
      setConfirmOpen(false);
      setNote("");
      // The payment rows + task payment_status rows changed server-side;
      // realtime also fires, but refresh the mounted view immediately so
      // the summary is exact (other caches stay untouched).
      await queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't mark the payments as paid");
    }
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        Couldn&apos;t load payments. Check your connection and try again.
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track who needs to be paid and what has been settled.
        </p>
      </div>

      {/* Summary from real aggregates (§31) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums tracking-tight",
              data.summary.pendingTotal > 0 && "text-amber-600 dark:text-amber-400"
            )}
          >
            {formatCurrency(data.summary.pendingTotal)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pending payouts ({data.summary.pendingCount})
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatCurrency(data.summary.paidThisWeek)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Paid this week</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatCurrency(data.summary.paidThisMonth)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Paid this month</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatCurrency(data.summary.paidTotal)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Paid all time</p>
        </div>
      </div>

      {/* Tabs + employee filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
          {(
            [
              ["pending", `Pending (${data.pending.length})`],
              ["paid", "Paid"],
              ["employees", "Employees"],
            ] as Array<[PaymentsTab, string]>
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={tab === value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {tab === "paid" && (
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
            aria-label="Filter by employee"
          >
            <option value="all">All employees</option>
            {employees
              .filter((e) => e.id !== "unassigned")
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        )}
      </div>

      {/* Pending tab — bulk selection (§35) */}
      {tab === "pending" && (
        <div className="space-y-3">
          {data.pending.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mr-1.5 inline size-4 text-emerald-500" />
              All payouts are up to date.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {selected.size > 0
                    ? `${selected.size} selected · ${formatCurrency(selectedTotal)}`
                    : "Select payouts to mark several as paid at once"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  <CheckCheck className="size-4" />
                  Mark selected as paid
                </Button>
              </div>
              <div className="divide-y rounded-xl border bg-card">
                {data.pending.map((t) => (
                  <div key={t.task_id} className="flex items-center gap-3 px-4 py-3">
                    <Checkbox
                      checked={selected.has(t.task_id)}
                      onCheckedChange={() => toggle(t.task_id)}
                      aria-label={`Select ${t.task_title}`}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/tasks/${t.task_id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {t.task_title}
                      </Link>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {t.employee_name} · {t.project_name ?? "—"}
                        {t.completed_at ? ` · done ${getRelativeTime(t.completed_at)}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatCurrency(t.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Paid tab */}
      {tab === "paid" && (
        <div className="divide-y rounded-xl border bg-card">
          {filteredPaid.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No paid payments{employeeFilter !== "all" ? " for this employee" : " yet"}.
            </p>
          ) : (
            filteredPaid.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/tasks/${p.task_id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {p.task_title}
                  </Link>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {p.employee_name ?? "—"}
                    {p.paid_at ? ` · paid ${formatDate(p.paid_at)}` : ""}
                    {p.payment_note ? ` · ${p.payment_note}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                  {formatCurrency(p.amount)}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Employees tab — per-employee payout summary (§34, §37) */}
      {tab === "employees" && (
        <div className="divide-y rounded-xl border bg-card">
          {employees.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Users className="mr-1.5 inline size-4" />
              No payment history yet.
            </p>
          ) : (
            employees.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setDrilldown(e)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
                  {e.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {e.pending > 0
                      ? `${formatCurrency(e.pending)} pending · ${e.paidThisMonth} paid this month`
                      : `${formatCurrency(e.paidTotal)} paid all time`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatCurrency(e.pending + e.paidTotal)}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Bulk confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {selected.size} payment{selected.size !== 1 ? "s" : ""} as paid?
            </DialogTitle>
            <DialogDescription>
              Total: {formatCurrency(selectedTotal)}. Employees will be notified.
              This records the payout — it doesn&apos;t transfer money.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Payment note (optional) — e.g. September weekly payout"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={marking}>
              Cancel
            </Button>
            <Button onClick={handleBulkPaid} disabled={marking}>
              {marking ? <Loader2 className="size-4 animate-spin" /> : <IndianRupee className="size-4" />}
              Confirm payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Employee drilldown */}
      <Dialog open={!!drilldown} onOpenChange={(open) => !open && setDrilldown(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{drilldown?.name}</DialogTitle>
            <DialogDescription>Payment history and pending work</DialogDescription>
          </DialogHeader>
          {drilldown && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {formatCurrency(drilldown.pending)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Pending</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(drilldown.paidThisWeek)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Paid this week</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(drilldown.paidThisMonth)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Paid this month</p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  History
                </p>
                <div className="divide-y rounded-lg border bg-card">
                  {drilldown.payments.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No payments recorded yet.
                    </p>
                  ) : (
                    drilldown.payments.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{p.task_title}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.paid_at ? formatDate(p.paid_at) : ""}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium tabular-nums">
                          {formatCurrency(p.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
