"use client";

import { useEffect, useState } from "react";
import { IndianRupee, CheckCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonCard } from "@/components/shared/skeleton-loader";
import { getPendingPaymentTasks, markPaymentPaid } from "@/lib/actions/payments";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

export default function PaymentsPage() {
  const [tasks, setTasks] = useState<Array<{
    id: string;
    title: string;
    payout_amount: number;
    assigned_user: { full_name: string } | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [paymentNote, setPaymentNote] = useState("");
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const result = await getPendingPaymentTasks();
      if (result.success && result.data) {
        setTasks(result.data);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleMarkPaid(taskId: string) {
    setMarkingId(taskId);
    const result = await markPaymentPaid(taskId, paymentNote || undefined);

    if (result.success) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast.success("Payment marked as paid");
      setPaymentNote("");
      setDialogTaskId(null);
    } else {
      toast.error(result.error || "Failed to mark payment");
    }
    setMarkingId(null);
  }

  const totalPending = tasks.reduce((sum, t) => sum + t.payout_amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Track task payouts and payment status"
      />

      {/* Summary */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
              <IndianRupee className="size-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatCurrency(totalPending)}</p>
              <p className="text-xs text-muted-foreground">Total Pending</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending Payments */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Pending Payments</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            title="No pending payments"
            description="All payments are up to date."
            icon={<CheckCircle className="size-8 text-green-600" />}
          />
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <Card key={task.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{task.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {task.assigned_user?.full_name || "Unassigned"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-semibold text-green-600">
                      {formatCurrency(task.payout_amount)}
                    </span>
                    <Dialog
                      open={dialogTaskId === task.id}
                      onOpenChange={(open) => {
                        if (open) {
                          setDialogTaskId(task.id);
                          setPaymentNote("");
                        } else {
                          setDialogTaskId(null);
                        }
                      }}
                    >
                      <DialogTrigger>
                        <Button size="sm" disabled={markingId === task.id}>
                          {markingId === task.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            "Mark Paid"
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Mark as Paid</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <p className="text-sm text-muted-foreground">
                            Mark {formatCurrency(task.payout_amount)} as paid for &ldquo;{task.title}&rdquo;?
                          </p>
                          <Textarea
                            placeholder="Payment note (optional)"
                            value={paymentNote}
                            onChange={(e) => setPaymentNote(e.target.value)}
                            rows={2}
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              onClick={() => handleMarkPaid(task.id)}
                              disabled={markingId === task.id}
                            >
                              {markingId === task.id ? (
                                <Loader2 className="size-4 animate-spin mr-2" />
                              ) : null}
                              Confirm Payment
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
