"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { createNotification, sendEventEmail } from "@/lib/notifications";
import type { ActionResponse } from "@/types/database";

export interface PendingPaymentTask {
  id: string;
  title: string;
  payout_amount: number;
  completed_at: string | null;
  assigned_user: { full_name: string } | null;
}

export interface PaidPayment {
  id: string;
  amount: number;
  paid_at: string | null;
  payment_note: string | null;
  task: { id: string; title: string } | null;
  employee_name: string | null;
}

export async function getPendingPaymentTasks(): Promise<
  ActionResponse<PendingPaymentTask[]>
> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, payout_amount, completed_at, assigned_user:profiles!tasks_assigned_to_fkey(full_name)"
      )
      .eq("payment_status", "PENDING")
      .gt("payout_amount", 0)
      .order("completed_at", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("[getPendingPaymentTasks]", error);
      return { success: false, error: "Failed to load pending payments" };
    }

    return {
      success: true,
      data: (data ?? []).map(
        (row: {
          id: string;
          title: string;
          payout_amount: number;
          completed_at: string | null;
          assigned_user: { full_name: string }[] | { full_name: string } | null;
        }) => {
          const u = Array.isArray(row.assigned_user)
            ? row.assigned_user[0]
            : row.assigned_user;
          return {
            id: row.id,
            title: row.title,
            payout_amount: Number(row.payout_amount),
            completed_at: row.completed_at,
            assigned_user: u ? { full_name: u.full_name } : null,
          };
        }
      ),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function getPaidPayments(): Promise<ActionResponse<PaidPayment[]>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, paid_at, payment_note, task:tasks(id, title, assigned_user:profiles!tasks_assigned_to_fkey(full_name))"
      )
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[getPaidPayments]", error);
      return { success: false, error: "Failed to load paid payments" };
    }

    type PaidRow = {
      id: string;
      amount: number;
      paid_at: string | null;
      payment_note: string | null;
      task: {
        id: string;
        title: string;
        assigned_user: { full_name: string }[] | { full_name: string } | null;
      } | null;
    };

    return {
      success: true,
      data: ((data ?? []) as unknown as PaidRow[]).map(
        (row: PaidRow) => {
          const u = row.task?.assigned_user
            ? Array.isArray(row.task.assigned_user)
              ? row.task.assigned_user[0]
              : row.task.assigned_user
            : null;
          return {
            id: row.id,
            amount: Number(row.amount),
            paid_at: row.paid_at,
            payment_note: row.payment_note,
            task: row.task ? { id: row.task.id, title: row.task.title } : null,
            employee_name: u?.full_name ?? null,
          };
        }
      ),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Mark a task's payout as paid. Admin-only, enforced server-side.
 * Creates or updates the payment record and notifies the employee.
 */
export async function markPaymentPaid(
  taskId: string,
  paymentNote?: string
): Promise<ActionResponse<{ amount: number }>> {
  try {
    const profile = await requireAdmin();
    const supabase = await createClient();

    const { data: task } = await supabase
      .from("tasks")
      .select("id, title, payout_amount, assigned_to")
      .eq("id", taskId)
      .single();

    if (!task) {
      return { success: false, error: "Task not found" };
    }
    if (Number(task.payout_amount) <= 0) {
      return { success: false, error: "This task has no payout amount" };
    }

    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("task_id", taskId)
      .maybeSingle();

    const amount = Number(task.payout_amount);

    if (existing) {
      const { error } = await supabase
        .from("payments")
        .update({
          paid_at: new Date().toISOString(),
          paid_by: profile.id,
          payment_note: paymentNote || null,
        })
        .eq("id", existing.id);
      if (error) {
        console.error("[markPaymentPaid] update", error);
        return { success: false, error: "Failed to mark payment as paid" };
      }
    } else {
      const { error } = await supabase.from("payments").insert({
        task_id: taskId,
        amount,
        paid_at: new Date().toISOString(),
        paid_by: profile.id,
        payment_note: paymentNote || null,
      });
      if (error) {
        console.error("[markPaymentPaid] insert", error);
        return { success: false, error: "Failed to mark payment as paid" };
      }
    }

    // Record which admin paid it
    await supabase.from("payments").update({ paid_by: profile.id }).eq("task_id", taskId);

    await supabase.from("tasks").update({ payment_status: "PAID" }).eq("id", taskId);

    // Notify + email the employee
    if (task.assigned_to) {
      await createNotification({
        userId: task.assigned_to,
        type: "PAYMENT_PAID",
        title: "Payment received",
        message: `₹${amount.toLocaleString("en-IN")} for "${task.title}" has been marked as paid`,
        referenceType: "task",
        referenceId: taskId,
      });

      const { data: assignee } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", task.assigned_to)
        .single();
      if (assignee?.email) {
        await sendEventEmail("PAYMENT_PAID", {
          to: assignee.email,
          employeeName: assignee.full_name,
          taskTitle: task.title,
          amount,
          paymentNote,
        });
      }
    }

    return { success: true, data: { amount } };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Employee "My payments" (§25)
// ──────────────────────────────────────────────

export interface MyPaymentsSummary {
  pendingTotal: number;
  pendingCount: number;
  paidThisMonth: number;
  items: Array<{
    id: string;
    task_id: string;
    task_title: string;
    amount: number;
    payment_status: "PENDING" | "PAID";
    paid_at: string | null;
  }>;
}

export async function getMyPayments(): Promise<ActionResponse<MyPaymentsSummary>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id, title, payout_amount, payment_status")
      .eq("assigned_to", profile.id)
      .in("payment_status", ["PENDING", "PAID"])
      .gt("payout_amount", 0)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[getMyPayments]", error);
      return { success: false, error: "Failed to load payments" };
    }

    const { data: payments } = await supabase
      .from("payments")
      .select("task_id, amount, paid_at")
      .not("paid_at", "is", null);
    const paidByTask = new Map<string, { amount: number; paid_at: string | null }>();
    (payments ?? []).forEach(
      (p: { task_id: string; amount: number; paid_at: string | null }) => {
        paidByTask.set(p.task_id, { amount: Number(p.amount), paid_at: p.paid_at });
      }
    );

    let pendingTotal = 0;
    let paidThisMonth = 0;
    const items: MyPaymentsSummary["items"] = [];

    (tasks ?? []).forEach(
      (t: {
        id: string;
        title: string;
        payout_amount: number;
        payment_status: "PENDING" | "PAID";
      }) => {
        const paid = paidByTask.get(t.id);
        if (t.payment_status === "PENDING") {
          pendingTotal += Number(t.payout_amount);
        } else if (paid?.paid_at && paid.paid_at >= startOfMonth) {
          paidThisMonth += paid.amount;
        }
        items.push({
          id: t.id,
          task_id: t.id,
          task_title: t.title,
          amount: Number(paid?.amount ?? t.payout_amount),
          payment_status: t.payment_status,
          paid_at: paid?.paid_at ?? null,
        });
      }
    );

    return {
      success: true,
      data: {
        pendingTotal,
        pendingCount: items.filter((i) => i.payment_status === "PENDING").length,
        paidThisMonth,
        items,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
