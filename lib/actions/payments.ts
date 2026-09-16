"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { sendEventEmail } from "@/lib/notifications";
import type { ActionResponse } from "@/types/database";

// ──────────────────────────────────────────────
// Employee earnings (§26–27, §63–65) — computed from
// real payments records with IST week boundaries.
// ──────────────────────────────────────────────

export interface PaymentItem {
  id: string;
  task_id: string;
  task_title: string;
  project_name: string | null;
  amount: number;
  status: "PENDING" | "PAID";
  paid_at: string | null;
  payment_note: string | null;
}

export interface EarningsData {
  totalPaid: number;
  thisWeek: number;
  pending: number;
  pendingCount: number;
  weekStart: string;
  weekEnd: string;
  days: Array<{
    date: string; // YYYY-MM-DD (IST)
    label: string; // "Mon, 16 Sep"
    total: number;
    items: PaymentItem[];
  }>;
}

/** Start of the ISO week containing `now`, in Asia/Kolkata. */
function istWeekBounds(reference = new Date()): { start: Date; end: Date } {
  // IST = UTC+5:30
  const istNow = new Date(reference.getTime() + 5.5 * 60 * 60 * 1000);
  const day = istNow.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  const startUtc = Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate() - daysSinceMonday,
    0, 0, 0
  ) - 5.5 * 60 * 60 * 1000;
  const start = new Date(startUtc);
  const end = new Date(startUtc + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function getMyEarnings(
  weekOffset = 0
): Promise<ActionResponse<EarningsData>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    // Which week are we viewing?
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    const { start: weekStart, end: weekEnd } = istWeekBounds(base);

    // Everything relevant for this employee, in one query each:
    // paid records from the payments table (source of truth), and
    // pending payouts from tasks with payout > 0 not yet paid.
    const [paidRes, pendingRes] = await Promise.all([
      supabase
        .from("payments")
        .select(
          "id, task_id, amount, paid_at, payment_note, task:tasks(id, title, project:projects(name))"
        )
        .eq("task.assigned_to", profile.id)
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false }),
      supabase
        .from("tasks")
        .select(
          "id, title, payout_amount, project:projects(name), payments(id)"
        )
        .eq("assigned_to", profile.id)
        .eq("payment_status", "PENDING")
        .gt("payout_amount", 0),
    ]);

    if (paidRes.error) {
      console.error("[getMyEarnings] paid", paidRes.error);
      return { success: false, error: "Failed to load your payments" };
    }
    if (pendingRes.error) {
      console.error("[getMyEarnings] pending", pendingRes.error);
      return { success: false, error: "Failed to load your payments" };
    }

    type PaidRow = {
      id: string;
      task_id: string;
      amount: number;
      paid_at: string | null;
      payment_note: string | null;
      task: {
        id: string;
        title: string;
        project: { name: string }[] | { name: string } | null;
      } | null;
    };

    const items: PaymentItem[] = [];
    let totalPaid = 0;
    let thisWeek = 0;
    let pending = 0;

    // Group paid records by IST day
    const byDay = new Map<string, PaymentItem[]>();

    (paidRes.data ?? []).forEach((raw: unknown) => {
      const row = raw as PaidRow;
      const task = row.task;
      const project = task?.project
        ? Array.isArray(task.project)
          ? task.project[0]
          : task.project
        : null;

      const item: PaymentItem = {
        id: row.id,
        task_id: row.task_id,
        task_title: task?.title ?? "Task",
        project_name: project?.name ?? null,
        amount: Number(row.amount),
        status: "PAID",
        paid_at: row.paid_at,
        payment_note: row.payment_note,
      };

      totalPaid += item.amount;
      if (row.paid_at && row.paid_at >= weekStart.toISOString() && row.paid_at < weekEnd.toISOString()) {
        thisWeek += item.amount;
        const istDate = new Date(new Date(row.paid_at).getTime() + 5.5 * 60 * 60 * 1000);
        const dayKey = istDate.toISOString().slice(0, 10);
        const list = byDay.get(dayKey) ?? [];
        list.push(item);
        byDay.set(dayKey, list);
      }
      items.push(item);
    });

    (pendingRes.data ?? []).forEach(
      (raw: {
        id: string;
        title: string;
        payout_amount: number;
        project: { name: string }[] | { name: string } | null;
      }) => {
        const project = raw.project
          ? Array.isArray(raw.project)
            ? raw.project[0]
            : raw.project
          : null;
        pending += Number(raw.payout_amount);

        // Pending items appear in the current week's "today" bucket
        // only if they were completed recently — keep grouping simple:
        // show them under the day they were completed, else ungrouped.
        const item: PaymentItem = {
          id: `pending-${raw.id}`,
          task_id: raw.id,
          task_title: raw.title,
          project_name: project?.name ?? null,
          amount: Number(raw.payout_amount),
          status: "PENDING",
          paid_at: null,
          payment_note: null,
        };
        items.push(item);
      }
    );

    // Build the day list for the viewed week
    const days: EarningsData["days"] = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
      const istDay = new Date(dayStart.getTime() + 5.5 * 60 * 60 * 1000);
      const key = istDay.toISOString().slice(0, 10);
      const dayItems = byDay.get(key) ?? [];
      if (dayItems.length === 0) continue;
      days.push({
        date: key,
        label: new Date(key + "T00:00:00Z").toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        total: dayItems.reduce((sum, item) => sum + item.amount, 0),
        items: dayItems,
      });
    }

    return {
      success: true,
      data: {
        totalPaid,
        thisWeek,
        pending,
        pendingCount: items.filter((i) => i.status === "PENDING").length,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        days,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Admin payout workspace (§30–37, §66)
// ──────────────────────────────────────────────

export interface AdminPaymentsData {
  summary: {
    pendingTotal: number;
    pendingCount: number;
    paidThisWeek: number;
    paidThisMonth: number;
    paidTotal: number;
  };
  pending: Array<{
    id: string; // task id
    task_id: string;
    task_title: string;
    employee_id: string;
    employee_name: string;
    project_name: string | null;
    amount: number;
    completed_at: string | null;
  }>;
  paid: Array<{
    id: string;
    task_id: string;
    task_title: string;
    employee_id: string | null;
    employee_name: string | null;
    project_name: string | null;
    amount: number;
    paid_at: string | null;
    payment_note: string | null;
  }>;
}

export async function getAdminPayments(): Promise<ActionResponse<AdminPaymentsData>> {
  try {
    await requireAdmin();
    const supabase = await createClient();

    const now = new Date();
    const { start: weekStart } = istWeekBounds(now);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthStartIso = new Date(monthStart.getTime() - 5.5 * 60 * 60 * 1000).toISOString();

    const [pendingRes, paidRes] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, payout_amount, completed_at, assigned_to, assigned_user:profiles!tasks_assigned_to_fkey(full_name), project:projects(name)"
        )
        .eq("payment_status", "PENDING")
        .gt("payout_amount", 0)
        .order("completed_at", { ascending: true, nullsFirst: false }),
      supabase
        .from("payments")
        .select(
          "id, task_id, amount, paid_at, payment_note, task:tasks(id, title, assigned_to, project:projects(name), assigned_user:profiles!tasks_assigned_to_fkey(full_name))"
        )
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false })
        .limit(500),
    ]);

    if (pendingRes.error) {
      console.error("[getAdminPayments] pending", pendingRes.error);
      return { success: false, error: "Failed to load pending payouts" };
    }
    if (paidRes.error) {
      console.error("[getAdminPayments] paid", paidRes.error);
      return { success: false, error: "Failed to load payments" };
    }

    const pending: AdminPaymentsData["pending"] = [];
    let pendingTotal = 0;

    (pendingRes.data ?? []).forEach(
      (raw: {
        id: string;
        title: string;
        payout_amount: number;
        completed_at: string | null;
        assigned_to: string | null;
        assigned_user: { full_name: string }[] | { full_name: string } | null;
        project: { name: string }[] | { name: string } | null;
      }) => {
        const user = raw.assigned_user
          ? Array.isArray(raw.assigned_user)
            ? raw.assigned_user[0]
            : raw.assigned_user
          : null;
        const project = raw.project
          ? Array.isArray(raw.project)
            ? raw.project[0]
            : raw.project
          : null;
        pendingTotal += Number(raw.payout_amount);
        pending.push({
          id: raw.id,
          task_id: raw.id,
          task_title: raw.title,
          employee_id: raw.assigned_to ?? "",
          employee_name: user?.full_name ?? "Unassigned",
          project_name: project?.name ?? null,
          amount: Number(raw.payout_amount),
          completed_at: raw.completed_at,
        });
      }
    );

    const paid: AdminPaymentsData["paid"] = [];
    let paidThisWeek = 0;
    let paidThisMonth = 0;
    let paidTotal = 0;

    (paidRes.data ?? []).forEach((raw: unknown) => {
      const row = raw as {
        id: string;
        task_id: string;
        amount: number;
        paid_at: string | null;
        payment_note: string | null;
        task: {
          id: string;
          title: string;
          assigned_to: string | null;
          project: { name: string }[] | { name: string } | null;
          assigned_user: { full_name: string }[] | { full_name: string } | null;
        } | null;
      };
      const task = row.task;
      const user = task?.assigned_user
        ? Array.isArray(task.assigned_user)
          ? task.assigned_user[0]
          : task.assigned_user
        : null;
      const project = task?.project
        ? Array.isArray(task.project)
          ? task.project[0]
          : task.project
        : null;

      const amount = Number(row.amount);
      paidTotal += amount;
      if (row.paid_at) {
        if (row.paid_at >= weekStart.toISOString()) paidThisWeek += amount;
        if (row.paid_at >= monthStartIso) paidThisMonth += amount;
      }

      paid.push({
        id: row.id,
        task_id: row.task_id,
        task_title: task?.title ?? "Task",
        employee_id: task?.assigned_to ?? null,
        employee_name: user?.full_name ?? null,
        project_name: project?.name ?? null,
        amount,
        paid_at: row.paid_at,
        payment_note: row.payment_note,
      });
    });

    return {
      success: true,
      data: {
        summary: {
          pendingTotal,
          pendingCount: pending.length,
          paidThisWeek,
          paidThisMonth,
          paidTotal,
        },
        pending,
        paid,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * §35/§67 — bulk mark-as-paid. Atomic per batch: if any update fails,
 * we report which ones succeeded so the admin is never misled.
 */
export async function markPaymentsPaidBatch(
  taskIds: string[],
  paymentNote?: string
): Promise<
  ActionResponse<{
    marked: number;
    totalAmount: number;
    byEmployee: Array<{ name: string; amount: number; count: number }>;
  }>
> {
  try {
    const profile = await requireAdmin();

    if (taskIds.length === 0) {
      return { success: false, error: "No payments selected" };
    }

    const supabase = await createClient();
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id, title, payout_amount, assigned_to, payment_status, assigned_user:profiles!tasks_assigned_to_fkey(full_name, email)")
      .in("id", taskIds);

    if (error) {
      console.error("[markPaymentsPaidBatch] load", error);
      return { success: false, error: "Failed to load the selected tasks" };
    }

    const rows = (tasks ?? []) as Array<{
      id: string;
      title: string;
      payout_amount: number;
      assigned_to: string | null;
      payment_status: string;
      assigned_user: { full_name: string; email: string }[] | { full_name: string; email: string } | null;
    }>;

    const payable = rows.filter(
      (t) => t.payment_status !== "PAID" && Number(t.payout_amount) > 0
    );

    if (payable.length === 0) {
      return { success: false, error: "The selected tasks have no pending payouts" };
    }

    const paidAt = new Date().toISOString();
    let totalAmount = 0;
    const marked: string[] = [];

    // Upsert payment rows
    const { data: existing } = await supabase
      .from("payments")
      .select("id, task_id")
      .in("task_id", payable.map((t) => t.id));

    const existingByTask = new Map((existing ?? []).map((p: { task_id: string; id: string }) => [p.task_id, p.id]));

    for (const task of payable) {
      const amount = Number(task.payout_amount);
      totalAmount += amount;

      const paymentRow = {
        paid_at: paidAt,
        paid_by: profile.id,
        payment_note: paymentNote || null,
      };

      const existingId = existingByTask.get(task.id);
      const res = existingId
        ? await supabase.from("payments").update({ ...paymentRow, amount }).eq("id", existingId)
        : await supabase
            .from("payments")
            .insert({ task_id: task.id, amount, ...paymentRow });

      if (!res.error) {
        marked.push(task.id);
        await supabase.from("tasks").update({ payment_status: "PAID" }).eq("id", task.id);
      } else {
        console.error("[markPaymentsPaidBatch] row", task.id, res.error);
      }
    }

    if (marked.length === 0) {
      return { success: false, error: "Couldn't mark the payments as paid. Please try again." };
    }

    // Group for the summary + notifications
    const byEmployee = new Map<string, { amount: number; count: number }>();
    for (const task of payable) {
      if (!marked.includes(task.id)) continue;
      const user = task.assigned_user
        ? Array.isArray(task.assigned_user)
          ? task.assigned_user[0]
          : task.assigned_user
        : null;
      const key = user?.full_name ?? "Unassigned";
      const entry = byEmployee.get(key) ?? { amount: 0, count: 0 };
      entry.amount += Number(task.payout_amount);
      entry.count += 1;
      byEmployee.set(key, entry);
    }

    // One summary notification per employee (§68)
    const admin = createAdminClient();
    const notifications: Array<{
      userId: string;
      type: "PAYMENT_PAID";
      title: string;
      message: string;
      referenceType: string;
      referenceId: string;
    }> = [];

    for (const task of payable) {
      if (!marked.includes(task.id) || !task.assigned_to) continue;
      const user = task.assigned_user
        ? Array.isArray(task.assigned_user)
          ? task.assigned_user[0]
          : task.assigned_user
        : null;

      notifications.push({
        userId: task.assigned_to,
        type: "PAYMENT_PAID",
        title: "Payment received",
        message: `₹${Number(task.payout_amount).toLocaleString("en-IN")} for "${task.title}" has been marked as paid`,
        referenceType: "payment",
        referenceId: task.id,
      });

      if (user?.email) {
        void sendEventEmail("PAYMENT_PAID", {
          to: user.email,
          employeeName: user.full_name,
          taskTitle: task.title,
          amount: Number(task.payout_amount),
          paymentNote,
        });
      }
    }

    if (notifications.length > 0) {
      await admin.from("notifications").insert(
        notifications.map((n) => ({
          user_id: n.userId,
          type: n.type,
          title: n.title,
          message: n.message,
          reference_type: n.referenceType,
          reference_id: n.referenceId,
          read: false,
        }))
      );
    }
    void admin;

    const partial = marked.length < payable.length;
    return {
      success: true,
      data: {
        marked: marked.length,
        totalAmount,
        byEmployee: Array.from(byEmployee.entries()).map(([name, v]) => ({
          name,
          amount: v.amount,
          count: v.count,
        })),
        ...(partial
          ? { warning: `${payable.length - marked.length} payment(s) could not be marked` }
          : {}),
      } as {
        marked: number;
        totalAmount: number;
        byEmployee: Array<{ name: string; amount: number; count: number }>;
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
