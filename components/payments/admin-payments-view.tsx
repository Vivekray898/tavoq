"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CheckCheck,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  createCustomPayment,
  createPaymentFromTasks,
  markPaymentPaid,
} from "@/lib/actions/payments";
import {
  paymentWorkspaceOptions,
  payableTasksOptions,
  activeEmployeesOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { formatCurrency, formatDate, formatDeadline, cn } from "@/lib/utils";
import { useSession } from "@/components/providers/session-provider";
import type { PaymentItem, PaymentWorkspaceData } from "@/lib/actions/payments";

/**
 * Dedicated employee payout management (§5–§11).
 *
 * Workflow: select employee → their payable tasks → select → Create
 * Payment. Custom (task-less) payments and payment status live here
 * and nowhere else. All data comes from cached queries the realtime
 * provider keeps fresh — no polling, no router refresh.
 */
export function AdminPaymentsView() {
  const queryClient = useQueryClient();
  const { role } = useSession();

  const { data, isLoading } = useQuery(paymentWorkspaceOptions);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customMarkPaid, setCustomMarkPaid] = useState(false);
  const [customSaving, setCustomSaving] = useState(false);

  // Employee selector uses the cached team list so names render even
  // before workspace history loads; fall back to the workspace list.
  const employeesQuery = useQuery(
    role === "ADMIN" ? activeEmployeesOptions : { ...activeEmployeesOptions, enabled: false }
  );
  const employees = useMemo(() => {
    const fromCache = (employeesQuery.data ?? []).map((e) => ({ id: e.id, name: e.full_name }));
    const fromWorkspace = (data?.employees ?? []).map((e) => ({ id: e.id, name: e.name }));
    const merged = new Map(fromCache.map((e) => [e.id, e.name]));
    for (const e of fromWorkspace) {
      if (!merged.has(e.id)) merged.set(e.id, e.name);
    }
    return Array.from(merged.entries()).map(([id, name]) => ({ id, name }));
  }, [employeesQuery.data, data?.employees]);

  const employeeItems = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e.name])),
    [employees]
  );

  const tasksQuery = useQuery(payableTasksOptions(selectedEmployeeId));
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.project_name ?? "").toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const selectedEntries = useMemo(
    () =>
      tasks
        .filter((t) => selected.has(t.id))
        .map((t) => ({ task: t, amount: selected.get(t.id) ?? t.payout_amount })),
    [tasks, selected]
  );
  const selectedTotal = selectedEntries.reduce((sum, e) => sum + e.amount, 0);

  const history = data?.history ?? [];
  const selectedEmployeeName = selectedEmployeeId
    ? (employeeItems[selectedEmployeeId] ?? "")
    : "";

  function toggleTask(id: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else {
        const task = tasks.find((t) => t.id === id);
        if (task) next.set(id, task.payout_amount);
      }
      return next;
    });
  }

  function setTaskAmount(id: string, amount: number) {
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, Math.max(0, amount));
      return next;
    });
  }

  const allVisibleSelected =
    filteredTasks.length > 0 && filteredTasks.every((t) => selected.has(t.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Map(prev);
        for (const t of filteredTasks) next.delete(t.id);
        return next;
      }
      const next = new Map(prev);
      for (const t of filteredTasks) {
        if (!t.has_payment) next.set(t.id, t.payout_amount);
      }
      return next;
    });
  }

  async function handleCreatePayment() {
    if (selectedEntries.length === 0) return;
    setCreating(true);
    const result = await createPaymentFromTasks(
      selectedEmployeeId,
      selectedEntries.map((e) => ({ task_id: e.task.id, amount: e.amount })),
      note.trim() || undefined
    );
    setCreating(false);
    if (result.success && result.data) {
      toast.success(
        `Payment recorded for ${result.data.employee_name} — ${formatCurrency(result.data.totalAmount)}`,
        { description: `${result.data.created} task payment(s) created.` }
      );
      setSelected(new Map());
      setConfirmOpen(false);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't create the payment");
    }
  }

  async function handleCreateCustom() {
    setCustomSaving(true);
    const result = await createCustomPayment(
      selectedEmployeeId,
      Number(customAmount),
      customDescription,
      customMarkPaid
    );
    setCustomSaving(false);
    if (result.success && result.data) {
      toast.success(
        `Custom payment (${formatCurrency(result.data.amount)}) ${result.data.status === "PAID" ? "recorded as paid" : "created as pending"} for ${result.data.employee_name}`
      );
      setCustomOpen(false);
      setCustomAmount("");
      setCustomDescription("");
      setCustomMarkPaid(false);
      void queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't create the payment");
    }
  }

  async function handleMarkPaid(payment: PaymentItem) {
    const result = await markPaymentPaid(payment.id);
    if (result.success && result.data) {
      toast.success(`Marked paid — ${formatCurrency(result.data.amount)}`);
      // Patch the history row directly; no broad refetch (§6).
      queryClient.setQueryData<PaymentWorkspaceData>(qk.paymentWorkspace(), (prev) =>
        prev
          ? {
              ...prev,
              history: prev.history.map((p) =>
                p.id === payment.id
                  ? { ...p, status: "PAID" as const, paid_at: result.data!.paid_at }
                  : p
              ),
            }
          : prev
      );
    } else {
      toast.error(result.error ?? "Couldn't mark the payment as paid");
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

  const { summary } = data;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage employee payouts — task-based or custom.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (!selectedEmployeeId) {
              toast.error("Select an employee first");
              return;
            }
            setCustomOpen(true);
          }}
        >
          <Plus className="size-4" /> Custom payment
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums tracking-tight",
              summary.pendingTotal > 0 && "text-amber-600 dark:text-amber-400"
            )}
          >
            {formatCurrency(summary.pendingTotal)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pending ({summary.pendingCount})
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatCurrency(summary.paidThisWeek)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Paid this week</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatCurrency(summary.paidThisMonth)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Paid this month</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatCurrency(summary.paidTotal)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Paid all time</p>
        </div>
      </div>

      {/* Step 1 — employee selector */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-72">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Employee
            </label>
            <Select
              items={employeeItems}
              value={selectedEmployeeId || undefined}
              onValueChange={(v) => {
                setSelectedEmployeeId(v ?? "");
                setSelected(new Map());
                setSearch("");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedEmployeeId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCustomOpen(true)}
              className="sm:hidden"
            >
              <Plus className="size-4" /> Custom payment
            </Button>
          )}
        </div>

        {/* Step 2 — the employee's tasks */}
        {selectedEmployeeId ? (
          tasksQuery.isLoading ? (
            <SkeletonList rows={4} />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative min-w-40 flex-1 sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tasks…"
                    className="pl-9"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {allVisibleSelected ? "Deselect all" : "Select all"}
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={selected.size === 0 || selectedTotal <= 0}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <IndianRupee className="size-4" />
                    Create payment
                  </Button>
                </div>
              </div>

              {filteredTasks.length === 0 ? (
                <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                  <Users className="mr-1.5 inline size-4" />
                  {search
                    ? "No tasks match your search."
                    : "No payable tasks for this employee right now."}
                </p>
              ) : (
                <div className="divide-y rounded-xl border bg-card">
                  {filteredTasks.map((t) => {
                    const isSelected = selected.has(t.id);
                    const amount = selected.get(t.id) ?? t.payout_amount;
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 transition-colors",
                          isSelected && "bg-accent/40"
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleTask(t.id)}
                          aria-label={`Select ${t.title}`}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/tasks/${t.id}`}
                            className="truncate text-sm font-medium hover:underline"
                          >
                            {t.title}
                          </Link>
                          <p className="truncate text-[13px] text-muted-foreground">
                            {t.project_name ?? "—"}
                            {t.deadline ? ` · due ${formatDeadline(t.deadline)}` : ""}
                            {` · ${t.status.replace(/_/g, " ").toLowerCase()}`}
                          </p>
                        </div>
                        {t.has_payment && (
                          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
                            <BadgeCheck className="size-3" /> Paid
                          </span>
                        )}
                        <div className="flex w-24 shrink-0 items-center justify-end gap-1">
                          <span className="text-xs text-muted-foreground">₹</span>
                          <Input
                            type="number"
                            min="0"
                            step="50"
                            value={isSelected ? String(amount) : String(t.payout_amount)}
                            disabled={!isSelected}
                            onChange={(e) => setTaskAmount(t.id, Number(e.target.value))}
                            className="h-7 w-20 text-right text-sm tabular-nums"
                            aria-label={`Amount for ${t.title}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )
        ) : (
          <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            Select an employee to see their tasks and create a payment.
          </p>
        )}
      </div>

      {/* Payment history — task-based + custom */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Payment history</h2>
        {history.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mr-1.5 inline size-4 text-emerald-500" />
            No payments recorded yet.
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {history.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                {p.status === "PAID" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                ) : (
                  <span className="size-2 shrink-0 rounded-full bg-amber-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.label}
                    {p.kind === "CUSTOM" && (
                      <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Custom
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {p.employee_name ?? "—"}
                    {p.project_name ? ` · ${p.project_name}` : ""}
                    {p.status === "PAID" && p.paid_at
                      ? ` · paid ${formatDate(p.paid_at)}`
                      : " · pending"}
                    {p.payment_note ? ` · ${p.payment_note}` : ""}
                  </p>
                </div>
                {p.status === "PENDING" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => handleMarkPaid(p)}
                  >
                    <CheckCheck className="size-4" />
                    Mark paid
                  </Button>
                )}
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    p.status === "PENDING" && "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {formatCurrency(p.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create-payment confirmation (per-task breakdown) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create payment for {selectedEmployeeName}?</DialogTitle>
            <DialogDescription>
              {selectedEntries.length} task payment{selectedEntries.length !== 1 ? "s" : ""} ·
              Employees are notified once the payout is recorded.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y rounded-lg border bg-card text-sm">
            {selectedEntries.map(({ task, amount }) => (
              <div key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatCurrency(amount)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(selectedTotal)}</span>
            </div>
          </div>
          <Input
            placeholder="Payment note (optional) — e.g. September weekly payout"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreatePayment} disabled={creating || selectedTotal <= 0}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <IndianRupee className="size-4" />}
              Create payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom payment dialog */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custom payment</DialogTitle>
            <DialogDescription>
              For {selectedEmployeeName || "the selected employee"} — not attached to any task.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Employee</label>
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {selectedEmployeeName || "—"}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="custom-amount">
                  Amount (₹) *
                </label>
                <Input
                  id="custom-amount"
                  type="number"
                  min="0"
                  step="50"
                  placeholder="2000"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="custom-desc">
                Description *
              </label>
              <Textarea
                id="custom-desc"
                rows={2}
                placeholder="e.g. Monthly performance bonus"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={customMarkPaid}
                onCheckedChange={(v) => setCustomMarkPaid(v === true)}
              />
              Mark as paid now
            </label>
            <p className="text-xs text-muted-foreground">
              Leave unchecked to record it as pending — you can mark it paid from the history
              below.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)} disabled={customSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateCustom}
              disabled={customSaving || !(Number(customAmount) > 0) || !customDescription.trim()}
            >
              {customSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
