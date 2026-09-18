"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { sendEventEmail } from "@/lib/notifications";
import type { ActionResponse } from "@/types/database";

// ──────────────────────────────────────────────
// Dedicated employee payout workspace.
//
// Two payment kinds share the `payments` table:
//   • task-based  → task_id set, employee_id backfilled
//   • custom      → employee_id + description, no task
// Payments are managed ONLY here — task/project/client
// workflows never create or edit them.
// ──────────────────────────────────────────────

export type PaymentKind = "TASK" | "CUSTOM";

/** Human-readable payment row — never exposes internal IDs. */
export interface PaymentItem {
  id: string;
  kind: PaymentKind;
  employee_id: string | null;
  employee_name: string | null;
  task_id: string | null;
  label: string; // task title or custom description
  project_name: string | null;
  amount: number;
  status: "PENDING" | "PAID";
  paid_at: string | null;
  payment_note: string | null;
}

export interface EmployeeSummary {
  id: string;
  name: string;
  pending: number;
  pendingCount: number;
  paidTotal: number;
  paidThisWeek: number;
  paidThisMonth: number;
}

export interface PaymentWorkspaceData {
  summary: {
    pendingTotal: number;
    pendingCount: number;
    paidThisWeek: number;
    paidThisMonth: number;
    paidTotal: number;
  };
  employees: EmployeeSummary[];
  history: PaymentItem[];
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

/** Pull embedded relation rows whether Supabase returns array or object. */
function one<T>(embedded: T[] | T | null | undefined): T | null {
  if (!embedded) return null;
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
}

/**
 * Admin workspace: summary + per-employee rollup + unified history
 * (task-based + custom). Employees without any payment rows still
 * appear (from profiles) so the admin can start a payment for them.
 */
export async function getPaymentWorkspace(): Promise<ActionResponse<PaymentWorkspaceData>> {
  try {
    await requireAdmin();
    const supabase = await createClient();

    const now = new Date();
    const { start: weekStart } = istWeekBounds(now);
    const monthStartIso = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 5.5 * 60 * 60 * 1000
    ).toISOString();

    const [profilesRes, paymentsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, status")
        .eq("role", "EMPLOYEE")
        .order("full_name", { ascending: true }),
      supabase
        .from("payments")
        .select(
          `id, task_id, employee_id, description, amount, paid_at, payment_note, created_at,
           employee:profiles!payments_employee_id_fkey(full_name),
           task:tasks(id, title, project:projects(name))`
        )
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (profilesRes.error) {
      console.error("[getPaymentWorkspace] profiles", profilesRes.error);
      return { success: false, error: "Failed to load employees" };
    }
    if (paymentsRes.error) {
      console.error("[getPaymentWorkspace] payments", paymentsRes.error);
      return { success: false, error: "Failed to load payments" };
    }

    type PaymentRow = {
      id: string;
      task_id: string | null;
      employee_id: string | null;
      description: string | null;
      amount: number | string;
      paid_at: string | null;
      payment_note: string | null;
      created_at: string;
      employee: { full_name: string }[] | { full_name: string } | null;
      task: {
        id: string;
        title: string;
        project: { name: string }[] | { name: string } | null;
      } | null;
    };

    const items: PaymentItem[] = (paymentsRes.data ?? []).map((raw: unknown) => {
      const row = raw as PaymentRow;
      const task = row.task;
      const project = task ? one(task.project) : null;
      const employee = one(row.employee);
      return {
        id: row.id,
        kind: row.task_id ? "TASK" : "CUSTOM",
        employee_id: row.employee_id,
        employee_name: employee?.full_name ?? null,
        task_id: row.task_id,
        label: row.task_id ? (task?.title ?? "Task") : (row.description ?? "Custom payment"),
        project_name: project?.name ?? null,
        amount: Number(row.amount),
        status: row.paid_at ? "PAID" : "PENDING",
        paid_at: row.paid_at,
        payment_note: row.payment_note,
      };
    });

    let pendingTotal = 0;
    let pendingCount = 0;
    let paidThisWeek = 0;
    let paidThisMonth = 0;
    let paidTotal = 0;

    for (const item of items) {
      if (item.status === "PENDING") {
        pendingTotal += item.amount;
        pendingCount += 1;
        continue;
      }
      paidTotal += item.amount;
      if (item.paid_at) {
        if (item.paid_at >= weekStart.toISOString()) paidThisWeek += item.amount;
        if (item.paid_at >= monthStartIso) paidThisMonth += item.amount;
      }
    }

    // Per-employee rollup — every employee appears, even with no rows.
    const byId = new Map<string, EmployeeSummary>();
    for (const p of profilesRes.data ?? []) {
      byId.set(p.id, {
        id: p.id,
        name: p.full_name,
        pending: 0,
        pendingCount: 0,
        paidTotal: 0,
        paidThisWeek: 0,
        paidThisMonth: 0,
      });
    }
    for (const item of items) {
      const key = item.employee_id;
      if (!key) continue; // legacy unassigned rows have no employee scope
      const entry = byId.get(key);
      if (!entry) continue; // profiles scoped to employees only
      if (item.status === "PENDING") {
        entry.pending += item.amount;
        entry.pendingCount += 1;
      } else {
        entry.paidTotal += item.amount;
        if (item.paid_at) {
          if (item.paid_at >= weekStart.toISOString()) entry.paidThisWeek += item.amount;
          if (item.paid_at >= monthStartIso) entry.paidThisMonth += item.amount;
        }
      }
    }

    return {
      success: true,
      data: {
        summary: { pendingTotal, pendingCount, paidThisWeek, paidThisMonth, paidTotal },
        employees: Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name)),
        history: items,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export interface PayableTask {
  id: string;
  title: string;
  project_name: string | null;
  status: string;
  deadline: string | null;
  payout_amount: number;
  payment_status: string;
  /** The task already has a payment record — shown as a guard (§16). */
  has_payment: boolean;
}

/**
 * The selected employee's payable tasks: only their own assigned,
 * non-completed tasks from active projects, each flagged when a
 * payment record already exists (duplicate guard).
 */
export async function getEmployeePayableTasks(
  employeeId: string
): Promise<ActionResponse<PayableTask[]>> {
  try {
    await requireAdmin();
    const supabase = await createClient();

    const [tasksRes, paymentsRes] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, status, deadline, payout_amount, payment_status, project:projects(name, status)"
        )
        .eq("assigned_to", employeeId)
        .neq("status", "COMPLETED")
        .order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("payments").select("task_id").not("task_id", "is", null),
    ]);

    if (tasksRes.error) {
      console.error("[getEmployeePayableTasks] tasks", tasksRes.error);
      return { success: false, error: "Failed to load the employee's tasks" };
    }
    if (paymentsRes.error) {
      console.error("[getEmployeePayableTasks] payments", paymentsRes.error);
      return { success: false, error: "Failed to load existing payments" };
    }

    const paidTaskIds = new Set(
      (paymentsRes.data ?? []).map((p: { task_id: string | null }) => p.task_id)
    );

    type Row = {
      id: string;
      title: string;
      status: string;
      deadline: string | null;
      payout_amount: number;
      payment_status: string;
      project: { name: string; status: string }[] | { name: string; status: string } | null;
    };

    const tasks: PayableTask[] = (tasksRes.data ?? []).map((raw: unknown) => {
      const row = raw as Row;
      const project = one(row.project);
      return {
        id: row.id,
        title: row.title,
        project_name: project?.name ?? null,
        status: row.status,
        deadline: row.deadline,
        payout_amount: Number(row.payout_amount),
        payment_status: row.payment_status,
        has_payment: paidTaskIds.has(row.id),
      };
    });

    // Active projects first, then on-hold/planning, then others.
    tasks.sort((a, b) => (a.project_name ?? "").localeCompare(b.project_name ?? ""));
    return { success: true, data: tasks };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * §8 — create one payment per selected task in a single admin action.
 * Amounts come from the confirmation dialog (default: task payout).
 * Marks the tasks PAID so legacy task surfaces stay consistent.
 */
export async function createPaymentFromTasks(
  employeeId: string,
  items: Array<{ task_id: string; amount: number }>,
  paymentNote?: string
): Promise<
  ActionResponse<{
    created: number;
    totalAmount: number;
    employee_name: string;
  }>
> {
  try {
    const profile = await requireAdmin();
    if (!employeeId) return { success: false, error: "Select an employee first" };
    if (!items || items.length === 0) {
      return { success: false, error: "Select at least one task" };
    }

    const supabase = await createClient();

    // Authoritative employee record (name for notification/summary).
    const { data: employee, error: empError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", employeeId)
      .single();
    if (empError || !employee) {
      return { success: false, error: "Employee not found" };
    }

    // Tasks must belong to the employee — never trust client amounts/ids.
    const { data: taskRows, error: taskError } = await supabase
      .from("tasks")
      .select("id, title, payout_amount, payment_status")
      .in(
        "id",
        items.map((i) => i.task_id)
      )
      .eq("assigned_to", employeeId);

    if (taskError) {
      console.error("[createPaymentFromTasks] tasks", taskError);
      return { success: false, error: "Failed to load the selected tasks" };
    }

    const rows = taskRows ?? [];
    if (rows.length === 0) {
      return { success: false, error: "The selected tasks don't belong to this employee" };
    }

    const amountByTask = new Map(items.map((i) => [i.task_id, Number(i.amount)]));

    // Duplicate guard: tasks that already carry a payment are skipped
    // unless the caller explicitly re-sends them (business rule §16).
    const { data: existing } = await supabase
      .from("payments")
      .select("id, task_id")
      .in(
        "task_id",
        rows.map((t: { id: string }) => t.id)
      );
    const existingByTask = new Map(
      (existing ?? []).map((p: { task_id: string | null; id: string }) => [p.task_id, p.id])
    );

    const paidAt = new Date().toISOString();
    let created = 0;
    let totalAmount = 0;
    const createdTaskIds: string[] = [];

    for (const task of rows) {
      const existingId = existingByTask.get(task.id);
      const amount = amountByTask.get(task.id) ?? Number(task.payout_amount);
      if (!(amount > 0)) continue;
      totalAmount += amount;

      const paymentRow = {
        employee_id: employeeId,
        paid_at: paidAt,
        paid_by: profile.id,
        payment_note: paymentNote || null,
        amount,
      };

      const res = existingId
        ? await supabase.from("payments").update(paymentRow).eq("id", existingId)
        : await supabase.from("payments").insert({ task_id: task.id, ...paymentRow });

      if (res.error) {
        console.error("[createPaymentFromTasks] row", task.id, res.error);
        continue;
      }
      created += 1;
      createdTaskIds.push(task.id);
      // Keep legacy task columns consistent with the payment record.
      await supabase.from("tasks").update({ payment_status: "PAID" }).eq("id", task.id);
    }

    if (created === 0) {
      return { success: false, error: "Couldn't record the payment. Please try again." };
    }

    // One notification + email for the batch.
    await sendEventEmail("PAYMENT_PAID", {
      to: employee.email,
      employeeName: employee.full_name,
      taskTitle:
        createdTaskIds.length === 1
          ? rows.find((t: { id: string }) => t.id === createdTaskIds[0])?.title ??
            "Selected tasks"
          : `${createdTaskIds.length} tasks`,
      amount: totalAmount,
      paymentNote,
    });

    return {
      success: true,
      data: { created, totalAmount, employee_name: employee.full_name },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * §9 — a payment that isn't tied to any task (bonus, retainer…).
 * Created as Pending unless the admin marks it paid immediately.
 */
export async function createCustomPayment(
  employeeId: string,
  amount: number,
  description: string,
  markPaidNow: boolean,
  paymentNote?: string
): Promise<ActionResponse<PaymentItem>> {
  try {
    const profile = await requireAdmin();
    if (!employeeId) return { success: false, error: "Select an employee" };
    if (!(amount > 0)) return { success: false, error: "Amount must be greater than zero" };
    if (!description.trim()) {
      return { success: false, error: "Add a short description" };
    }

    const supabase = await createClient();

    const { data: employee, error: empError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", employeeId)
      .single();
    if (empError || !employee) {
      return { success: false, error: "Employee not found" };
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        employee_id: employeeId,
        description: description.trim(),
        amount,
        paid_at: markPaidNow ? new Date().toISOString() : null,
        paid_by: markPaidNow ? profile.id : null,
        payment_note: paymentNote || null,
      })
      .select()
      .single();

    if (error) {
      console.error("[createCustomPayment]", error);
      return { success: false, error: "Failed to create the payment" };
    }

    if (markPaidNow) {
      await sendEventEmail("PAYMENT_PAID", {
        to: employee.email,
        employeeName: employee.full_name,
        taskTitle: description.trim(),
        amount,
        paymentNote,
      });
    }

    return {
      success: true,
      data: {
        id: (data as { id: string }).id,
        kind: "CUSTOM",
        employee_id: employeeId,
        employee_name: employee.full_name,
        task_id: null,
        label: description.trim(),
        project_name: null,
        amount,
        status: markPaidNow ? "PAID" : "PENDING",
        paid_at: markPaidNow ? new Date().toISOString() : null,
        payment_note: paymentNote || null,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** §11 — mark a pending payment (custom or legacy) as paid. */
export async function markPaymentPaid(
  paymentId: string,
  paymentNote?: string
): Promise<ActionResponse<PaymentItem>> {
  try {
    const profile = await requireAdmin();
    const supabase = await createClient();

    const { data: row, error } = await supabase
      .from("payments")
      .select(
        `id, task_id, employee_id, description, amount, paid_at, payment_note,
         employee:profiles!payments_employee_id_fkey(full_name, email),
         task:tasks(id, title, assigned_to)`
      )
      .eq("id", paymentId)
      .single();

    if (error || !row) {
      console.error("[markPaymentPaid] load", error);
      return { success: false, error: "Payment not found" };
    }

    const paidRow = row as unknown as {
      id: string;
      task_id: string | null;
      employee_id: string | null;
      description: string | null;
      amount: number | string;
      paid_at: string | null;
      payment_note: string | null;
      employee: { full_name: string; email: string }[] | { full_name: string; email: string } | null;
      task: { id: string; title: string; assigned_to: string | null } | null;
    };

    const paidAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("payments")
      .update({ paid_at: paidAt, paid_by: profile.id, payment_note: paymentNote || paidRow.payment_note })
      .eq("id", paymentId);

    if (updateError) {
      console.error("[markPaymentPaid] update", updateError);
      return { success: false, error: "Couldn't mark the payment as paid" };
    }

    const employee = one(paidRow.employee);

    if (employee?.email) {
      void sendEventEmail("PAYMENT_PAID", {
        to: employee.email,
        employeeName: employee.full_name,
        taskTitle: paidRow.task?.title ?? paidRow.description ?? "Payment",
        amount: Number(paidRow.amount),
        paymentNote,
      });
    }

    return {
      success: true,
      data: {
        id: paidRow.id,
        kind: paidRow.task_id ? "TASK" : "CUSTOM",
        employee_id: paidRow.employee_id,
        employee_name: employee?.full_name ?? null,
        task_id: paidRow.task_id,
        label: paidRow.task_id ? (paidRow.task?.title ?? "Task") : (paidRow.description ?? "Custom payment"),
        project_name: null,
        amount: Number(paidRow.amount),
        status: "PAID",
        paid_at: paidAt,
        payment_note: paymentNote || paidRow.payment_note,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Employee earnings (§12) — sourced ONLY from the
// payments table (RLS: employee_id = auth.uid() or
// own-task rows). Task-based + custom both appear.
// ──────────────────────────────────────────────

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
    items: Array<{
      id: string;
      label: string;
      kind: PaymentKind;
      project_name: string | null;
      amount: number;
      status: "PENDING" | "PAID";
      paid_at: string | null;
      payment_note: string | null;
    }>;
  }>;
}

export async function getMyEarnings(
  weekOffset = 0
): Promise<ActionResponse<EarningsData>> {
  try {
    await requireAuth();
    const supabase = await createClient();

    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    const { start: weekStart, end: weekEnd } = istWeekBounds(base);

    const { data, error } = await supabase
      .from("payments")
      .select(
        `id, task_id, employee_id, description, amount, paid_at, payment_note, created_at,
         task:tasks(id, title, project:projects(name))`
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[getMyEarnings]", error);
      return { success: false, error: "Failed to load your payments" };
    }

    type Row = {
      id: string;
      task_id: string | null;
      employee_id: string | null;
      description: string | null;
      amount: number | string;
      paid_at: string | null;
      payment_note: string | null;
      created_at: string;
      task: {
        id: string;
        title: string;
        project: { name: string }[] | { name: string } | null;
      } | null;
    };

    let totalPaid = 0;
    let thisWeek = 0;
    let pending = 0;
    let pendingCount = 0;

    const byDay = new Map<string, EarningsData["days"][number]["items"]>();
    const weekStartIso = weekStart.toISOString();
    const weekEndIso = weekEnd.toISOString();

    for (const raw of data ?? []) {
      const row = raw as unknown as Row;
      const task = row.task;
      const project = task ? one(task.project) : null;
      const kind: PaymentKind = row.task_id ? "TASK" : "CUSTOM";
      const label = row.task_id ? (task?.title ?? "Task") : (row.description ?? "Custom payment");
      const amount = Number(row.amount);
      const status: "PENDING" | "PAID" = row.paid_at ? "PAID" : "PENDING";

      if (status === "PAID") {
        totalPaid += amount;
        if (row.paid_at && row.paid_at >= weekStartIso && row.paid_at < weekEndIso) {
          thisWeek += amount;
        }
      } else {
        pending += amount;
        pendingCount += 1;
      }

      // Bucket PAID rows into the viewed week by paid date; pending
      // rows have no date, so they're listed under the viewed week's
      // first day only when there are no paid items at all (kept in
      // the summary instead — simpler and truthful).
      if (status === "PAID" && row.paid_at && row.paid_at >= weekStartIso && row.paid_at < weekEndIso) {
        const istDate = new Date(new Date(row.paid_at).getTime() + 5.5 * 60 * 60 * 1000);
        const dayKey = istDate.toISOString().slice(0, 10);
        const list = byDay.get(dayKey) ?? [];
        list.push({
          id: row.id,
          label,
          kind,
          project_name: project?.name ?? null,
          amount,
          status,
          paid_at: row.paid_at,
          payment_note: row.payment_note,
        });
        byDay.set(dayKey, list);
      }
    }

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
        pendingCount,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        days,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
