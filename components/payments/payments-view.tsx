"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { createClient } from "@/lib/supabase/client";
import {
  getPendingPaymentTasks,
  getPaidPayments,
  markPaymentPaid,
  type PendingPaymentTask,
  type PaidPayment,
} from "@/lib/actions/payments";
import { formatCurrency, formatDate, getRelativeTime } from "@/lib/utils";

export function PaymentsView() {
  const [pending, setPending] = useState<PendingPaymentTask[]>([]);
  const [paid, setPaid] = useState<PaidPayment[]>([]);
  const [loading, setLoading] = useState(true);

  // Mark-paid dialog
  const [dialogTask, setDialogTask] = useState<PendingPaymentTask | null>(null);
  const [note, setNote] = useState("");
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    const [pendingRes, paidRes] = await Promise.all([
      getPendingPaymentTasks(),
      getPaidPayments(),
    ]);
    if (pendingRes.success && pendingRes.data) setPending(pendingRes.data);
    if (paidRes.success && paidRes.data) setPaid(paidRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  // Realtime: payment changes → refresh (§26)
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("payments-view")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(load, 400);
        }
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function handleMarkPaid() {
    if (!dialogTask) return;
    setMarking(true);
    const result = await markPaymentPaid(dialogTask.id, note.trim() || undefined);
    setMarking(false);
    if (result.success) {
      toast.success(
        `Payment marked as paid — ${formatCurrency(result.data?.amount ?? dialogTask.payout_amount)}`
      );
      setPending((prev) => prev.filter((t) => t.id !== dialogTask.id));
      setDialogTask(null);
      setNote("");
      load();
    } else {
      toast.error(result.error ?? "Couldn't mark payment as paid");
    }
  }

  const totalPending = pending.reduce((sum, t) => sum + t.payout_amount, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Payments</h1>
        {totalPending > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCurrency(totalPending)} pending across {pending.length} task
            {pending.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Pending */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Pending</h2>
        {loading ? (
          <SkeletonList rows={3} />
        ) : pending.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mr-1.5 inline size-4 text-emerald-500" />
            All payments are up to date.
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {pending.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/tasks/${t.id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {t.title}
                  </Link>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {t.assigned_user?.full_name ?? "Unassigned"}
                    {t.completed_at ? ` · completed ${getRelativeTime(t.completed_at)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold">
                  {formatCurrency(t.payout_amount)}
                </span>
                <Button size="sm" onClick={() => setDialogTask(t)} className="shrink-0">
                  Mark paid
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Paid */}
      {paid.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Paid</h2>
          <div className="divide-y rounded-xl border bg-card">
            {paid.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  {p.task ? (
                    <Link
                      href={`/tasks/${p.task.id}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {p.task.title}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium">Payment</p>
                  )}
                  <p className="truncate text-[13px] text-muted-foreground">
                    {p.employee_name ?? "—"}
                    {p.paid_at ? ` · ${formatDate(p.paid_at)}` : ""}
                    {p.payment_note ? ` · ${p.payment_note}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium text-muted-foreground">
                  {formatCurrency(p.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Confirmation dialog (§26) */}
      <Dialog open={!!dialogTask} onOpenChange={(open) => !open && setDialogTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {formatCurrency(dialogTask?.payout_amount ?? 0)} as paid?
            </DialogTitle>
          </DialogHeader>
          {dialogTask && (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                Employee: <span className="font-medium text-foreground">{dialogTask.assigned_user?.full_name}</span>
              </p>
              <p className="text-muted-foreground">
                Task: <span className="font-medium text-foreground">{dialogTask.title}</span>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogTask(null)} disabled={marking}>
              Cancel
            </Button>
            <Button onClick={handleMarkPaid} disabled={marking}>
              {marking && <Loader2 className="size-4 animate-spin" />}
              Mark as paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
