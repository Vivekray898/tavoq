"use server";

import { createClient } from "@/lib/supabase/server";
import { requireStaff, requireAuth } from "@/lib/auth";
import { createNotification, sendEventEmail } from "@/lib/notifications";
import type { ActionResponse } from "@/types/database";
import { formatCurrency } from "@/lib/utils";

// ──────────────────────────────────────────────
// Dedicated employee payout workspace.
//
// Two payment kinds share the `payments` table:
//   • task-based  → task_id set, employee_id backfilled
//   • custom      → employee_id + description, no task
// Payments are managed ONLY here — task/project/client
// workflows never create or edit them.
// ──────────────────────────────────────────────

// Payment shapes and the adjustment fold live in a pure module so they
// can be unit tested — this file is "use server", which the node test
// runner cannot import, and Next requires every export of a "use server"
// file to be an async function (so the values are re-exported from
// lib/payments/adjustments rather than from here).
import {
  foldAdjustments,
  one,
  resolveLedgerStatus,
  type PaymentItem,
  type PaymentLedgerRow,
  type PaymentKind,
  type LedgerStatus,
} from "@/lib/payments/adjustments";
import { toPaise, toRupees } from "@/lib/payments/money";
import { markPaidSchema, type MarkPaidInput } from "@/validators/schemas";

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
    /**
     * Counts that must stay paired with their window.
     *
     * The metrics strip previously rendered "Paid this week" with the
     * all-time paid count, so a week with one payout read as though it
     * contained every payment ever made. Each count below is scoped to
     * the window named beside it and is never substituted for another.
     */
    paidThisWeekCount: number;
    paidThisMonthCount: number;
    /** Same calendar window, previous period — drives the delta sub-line. */
    paidLastWeek: number;
    paidLastWeekCount: number;
    paidLastMonth: number;
    paidCancelledTotal: number;
    paidCancelledCount: number;
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

export async function getPaymentWorkspace(): Promise<ActionResponse<PaymentWorkspaceData>> {
  try {
    await requireStaff();
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
          `id, task_id, employee_id, description, amount, amount_paise, status, type,
           payment_method, reference_number, due_date,
           paid_at, payment_note, created_at,
           kind, parent_payment_id,
           employee:profiles!payments_employee_id_fkey(full_name, email),
           paid_by_profile:profiles!payments_paid_by_fkey(full_name),
           task:tasks(id, title, project:projects(name, client:clients(name)))`
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

    // §6 — created date is shown on every payment detail.
    // Adjustments are folded into their parent here, so every rollup
    // below sums NET amounts without knowing adjustments exist.
    const items: PaymentItem[] = foldAdjustments(
      (paymentsRes.data ?? []) as unknown as PaymentLedgerRow[]
    );

    // The workspace totals come from ONE server-side RPC rather than a
    // loop over up to 500 rows. Beyond the extra rows it costs, the old
    // loop had a real defect: it derived every window from a single
    // all-time `paidCount`, so "Paid this week" reported the lifetime
    // count. get_payments_summary returns per-window counts.
    const { data: summaryRow, error: summaryError } = await supabase.rpc(
      "get_payments_summary"
    );

    let pendingTotal = 0;
    let pendingCount = 0;
    let paidThisWeek = 0;
    let paidThisMonth = 0;
    let paidTotal = 0;
    let paidThisWeekCount = 0;
    let paidThisMonthCount = 0;
    let paidLastWeek = 0;
    let paidLastWeekCount = 0;
    let paidLastMonth = 0;
    let paidCancelledTotal = 0;
    let paidCancelledCount = 0;

    if (summaryError) {
      // Degrade to the JS rollup rather than failing the whole page: the
      // rows are already loaded, and a summary card is not worth an error
      // boundary. Logged so a broken RPC is visible in production.
      console.error("[getPaymentWorkspace] summary rpc", summaryError);
      for (const item of items) {
        if (item.status === "PENDING") {
          pendingTotal += item.amount;
          pendingCount += 1;
          continue;
        }
        if (item.status !== "PAID") continue;
        paidTotal += item.amount;
        if (item.paid_at) {
          if (item.paid_at >= weekStart.toISOString()) paidThisWeek += item.amount;
          if (item.paid_at >= monthStartIso) paidThisMonth += item.amount;
        }
      }
    } else if (summaryRow && summaryRow.length > 0) {
      const summary = summaryRow[0] as {
        pending_total: number;
        pending_count: number;
        paid_total: number;
        paid_this_week: number;
        paid_this_month: number;
        paid_this_week_count: number;
        paid_this_month_count: number;
        paid_last_week: number;
        paid_last_month: number;
        cancelled_total: number;
        cancelled_count: number;
      };
      pendingTotal = toRupees(summary.pending_total);
      pendingCount = Number(summary.pending_count);
      paidTotal = toRupees(summary.paid_total);
      paidThisWeek = toRupees(summary.paid_this_week);
      paidThisMonth = toRupees(summary.paid_this_month);
      paidThisWeekCount = Number(summary.paid_this_week_count);
      paidThisMonthCount = Number(summary.paid_this_month_count);
      paidLastWeek = toRupees(summary.paid_last_week);
      paidLastMonth = toRupees(summary.paid_last_month);
      paidCancelledTotal = toRupees(summary.cancelled_total);
      paidCancelledCount = Number(summary.cancelled_count);
      // The RPC returns one last-week AMOUNT, not its count, so derive
      // the count from the loaded rows over the same window. Amounts
      // stay RPC-sourced; this is only a count.
      const lastWeekStartMs = weekStart.getTime() - 7 * 86_400_000;
      paidLastWeekCount = items.filter((p) => {
        if (p.status !== "PAID" || !p.paid_at) return false;
        const t = new Date(p.paid_at).getTime();
        return Number.isFinite(t) && t >= lastWeekStartMs && t < weekStart.getTime();
      }).length;
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
      } else if (item.status === "PAID") {
        // CANCELLED is neither pending nor paid — counting it as paid
        // would put money in a payroll total that never left the bank.
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
        summary: {
          pendingTotal,
          pendingCount,
          paidThisWeek,
          paidThisMonth,
          paidTotal,
          paidThisWeekCount,
          paidThisMonthCount,
          paidLastWeek,
          paidLastWeekCount,
          paidLastMonth,
          paidCancelledTotal,
          paidCancelledCount,
        },
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
 * The selected employee's payable tasks: only their own assigned
 * tasks from active projects, each flagged when a payment record
 * already exists (duplicate guard).
 *
 * Completed tasks are included on purpose — completing a task is what
 * makes it payable, and the completion trigger may already have created
 * its PENDING payment row.
 */
export async function getEmployeePayableTasks(
  employeeId: string
): Promise<ActionResponse<PayableTask[]>> {
  try {
    await requireStaff();
    const supabase = await createClient();

    const [tasksRes, paymentsRes] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, status, deadline, payout_amount, payment_status, project:projects(name, status)"
        )
        .eq("assigned_to", employeeId)
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
      /** NUMERIC arrives as a string from PostgREST; null when unset. */
      payout_amount: number | string | null;
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
        payout_amount: Number(row.payout_amount ?? 0),
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
    const profile = await requireStaff();
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
      const amount = amountByTask.get(task.id) ?? Number(task.payout_amount ?? 0);
      if (!(amount > 0)) {
        // The confirm dialog should never send these; warn instead of
        // silently dropping the row so a real regression is visible.
        console.warn(
          "[createPaymentFromTasks] skipping task with a non-positive amount",
          { taskId: task.id, amount }
        );
        continue;
      }
      totalAmount += amount;

      const paymentRow = {
        employee_id: employeeId,
        // amount_paise is authoritative. `amount` (NUMERIC) is still
        // written because the column is NOT NULL and several read paths
        // (dashboard, employees, getMyEarnings) still sum it. Both are
        // derived from the same rupee value in one place, so they cannot
        // disagree. Dropping `amount` is a follow-up migration.
        amount_paise: toPaise(amount),
        amount,
        status: "PAID",
        type: "TASK_PAYOUT",
        payment_method: "OTHER",
        payee: employeeId,
        created_by: profile.id,
        paid_at: paidAt,
        paid_by: profile.id,
        payment_note: paymentNote || null,
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

    // §71 — phone ping. createPaymentFromTasks always marks the payment
    // paid (paidAt is set unconditionally), so there is always money to
    // announce here.
    void notifyPaymentPaid(
      employeeId,
      createdTaskIds.length === 1
        ? (rows.find((t: { id: string }) => t.id === createdTaskIds[0])?.title ?? "Task")
        : `${createdTaskIds.length} tasks`,
      totalAmount,
      createdTaskIds.length === 1 ? createdTaskIds[0] : null,
      employee.full_name
    );

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
    const profile = await requireStaff();
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
        payee: employeeId,
        created_by: profile.id,
        description: description.trim(),
        amount_paise: toPaise(amount),
        amount,
        type: "CUSTOM",
        status: markPaidNow ? "PAID" : "PENDING",
        // PAID rows must carry the full paid_* triple or the
        // payments_paid_complete constraint rejects them. Legacy rows are
        // backfilled with OTHER; the real method arrives with the
        // mark-paid dialog in step C.
        payment_method: markPaidNow ? "OTHER" : null,
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

      // §71 — same gate as the email: only when money actually moved.
      // A payment created as PENDING is announced when it is later
      // marked paid, not here.
      void notifyPaymentPaid(
        employeeId,
        description.trim(),
        amount,
        null,
        employee.full_name
      );
    }

    return {
      success: true,
      data: {
        id: (data as { id: string }).id,
        kind: "CUSTOM",
        employee_id: employeeId,
        employee_name: employee.full_name,
        employee_email: employee.email,
        task_id: null,
        label: description.trim(),
        project_name: null,
        client_name: null,
        amount,
        base_amount: amount,
        adjustment_total: 0,
        adjustments: [],
        status: markPaidNow ? "PAID" : "PENDING",
        paid_at: markPaidNow ? new Date().toISOString() : null,
        payment_note: paymentNote || null,
        amount_paise: toPaise(amount),
        base_amount_paise: toPaise(amount),
        type: "CUSTOM",
        method: markPaidNow ? "OTHER" : null,
        reference_number: null,
        due_date: null,
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
    const profile = await requireStaff();
    const supabase = await createClient();

    const { data: row, error } = await supabase
      .from("payments")
      .select(
        `id, task_id, employee_id, description, amount, amount_paise, status, type,
         payment_method, reference_number, due_date, paid_at, payment_note,
         employee:profiles!payments_employee_id_fkey(full_name, email),
         task:tasks(id, title, status, assigned_to)`
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
      amount_paise: number | string;
      status: LedgerStatus;
      payment_method: string | null;
      reference_number: string | null;
      due_date: string | null;
      paid_at: string | null;
      payment_note: string | null;
      created_at?: string;
      employee: { full_name: string; email: string }[] | { full_name: string; email: string } | null;
      task: { id: string; title: string; status: string; assigned_to: string | null } | null;
    };

    const paidAt = new Date().toISOString();

    // Reject a payment the task rules forbid BEFORE writing, so the user
    // gets the real reason. mark_payments_paid re-checks the same rule
    // under a row lock — this is a fast path, not the guarantee.
    if (paidRow.status === "PAID") {
      return { success: false, error: "This payment is already marked paid" };
    }
    if (paidRow.status === "CANCELLED") {
      return { success: false, error: "This payment was cancelled" };
    }
    if (paidRow.task_id && paidRow.task && paidRow.task.status !== "APPROVED") {
      return {
        success: false,
        error: "A task payout can only be paid once the task is approved",
      };
    }

    const { error: updateError } = await supabase
      .from("payments")
      .update({
        status: "PAID",
        paid_at: paidAt,
        paid_by: profile.id,
        // The full paid_* triple is required for PAID. The real method
        // picker arrives in step C; OTHER keeps the row valid until then.
        payment_method: paidRow.payment_method ?? "OTHER",
        payment_note: paymentNote || paidRow.payment_note,
      })
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

    // §71 — "you were paid" is the notification people actually want on
    // their phone, so it goes out over push as well as email. Keyed on
    // employee_id (not email) because push subscriptions belong to a
    // user id.
    if (paidRow.employee_id) {
      void notifyPaymentPaid(
        paidRow.employee_id,
        paidRow.task?.title ?? paidRow.description ?? "Payment",
        Number(paidRow.amount),
        paidRow.task_id
      );
    }

    return {
      success: true,
      data: {
        id: paidRow.id,
        kind: paidRow.task_id ? "TASK" : "CUSTOM",
        employee_id: paidRow.employee_id,
        employee_name: employee?.full_name ?? null,
        employee_email: employee?.email ?? null,
        task_id: paidRow.task_id,
        label: paidRow.task_id ? (paidRow.task?.title ?? "Task") : (paidRow.description ?? "Custom payment"),
        project_name: null,
        client_name: null,
        amount: Number(paidRow.amount),
        base_amount: Number(paidRow.amount),
        adjustment_total: 0,
        adjustments: [],
        status: "PAID",
        paid_at: paidAt,
        payment_note: paymentNote || paidRow.payment_note,
        created_at: paidRow.created_at,
        amount_paise: Number(paidRow.amount_paise),
        base_amount_paise: Number(paidRow.amount_paise),
        type: "TASK_PAYOUT",
        method: "OTHER",
        reference_number: null,
        due_date: paidRow.due_date,
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
      /** NET amount, including any bonus or deduction applied. */
      amount: number;
      /** Net of adjustments; 0 when none. Drives the hint under the row. */
      adjustment_total: number;
      status: LedgerStatus;
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
        `id, task_id, employee_id, description, amount, amount_paise, status, type,
         payment_method, reference_number, due_date, paid_at, payment_note, created_at,
         kind, parent_payment_id,
         task:tasks(id, title, project:projects(name))`
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[getMyEarnings]", error);
      return { success: false, error: "Failed to load your payments" };
    }

    type Row = PaymentLedgerRow;

    // Fold adjustments the same way the workspace does, so the employee
    // sees the NET they actually received. Unlike the workspace, an
    // adjustment whose parent is missing here is a real inconsistency
    // (RLS guarantees an employee can only ever read their own rows),
    // so it is kept as its own entry rather than silently discarded.
    const adjustmentsByParent = new Map<string, number>();
    for (const raw of data ?? []) {
      const row = raw as unknown as Row;
      if ((row.kind ?? "PAYMENT") !== "ADJUSTMENT") continue;
      const parentId = row.parent_payment_id;
      if (!parentId) continue;
      adjustmentsByParent.set(
        parentId,
        (adjustmentsByParent.get(parentId) ?? 0) + Number(row.amount)
      );
    }

    let totalPaid = 0;
    let thisWeek = 0;
    let pending = 0;
    let pendingCount = 0;

    const byDay = new Map<string, EarningsData["days"][number]["items"]>();
    const weekStartIso = weekStart.toISOString();
    const weekEndIso = weekEnd.toISOString();

    for (const raw of data ?? []) {
      const row = raw as unknown as Row;
      // An adjustment is never its own line here; it is folded into its
      // parent below. An adjustment with no readable parent is kept as a
      // standalone entry so the employee still sees the money.
      const isAdjustment = (row.kind ?? "PAYMENT") === "ADJUSTMENT";
      const isOrphanAdjustment = isAdjustment && row.parent_payment_id
        ? !data?.some((p) => (p as unknown as Row).id === row.parent_payment_id)
        : isAdjustment;
      if (isAdjustment && !isOrphanAdjustment) continue;

      const task = row.task;
      const project = task ? one(task.project) : null;
      const kind: PaymentKind = row.task_id ? "TASK" : "CUSTOM";
      const label = row.task_id ? (task?.title ?? "Task") : (row.description ?? "Custom payment");
      const adjustment_total = isAdjustment ? 0 : (adjustmentsByParent.get(row.id) ?? 0);
      const amount = Number(row.amount) + adjustment_total;
      // Prefer the stored ledger status; the paid_at fallback keeps rows
      // that predate migration 025 reading correctly.
      const status = resolveLedgerStatus(row);

      if (status === "PAID") {
        totalPaid += amount;
        if (row.paid_at && row.paid_at >= weekStartIso && row.paid_at < weekEndIso) {
          thisWeek += amount;
        }
      } else if (status === "PENDING") {
        // CANCELLED is neither owed nor paid, so it belongs in neither
        // total — counting it would misstate an employee's balance.
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
          adjustment_total,
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

// ──────────────────────────────────────────────
// §8 — Bulk mark-paid: one round-trip for a
// selection of pending payments. Returns the
// canonical rows so the client can patch caches.
// ──────────────────────────────────────────────

export async function markPaymentsPaidBatch(
  paymentIds: string[],
  paymentNote?: string,
  paymentMethod: MarkPaidInput["method"] = "OTHER",
  paidOn?: string,
  referenceNumber?: string
): Promise<
  ActionResponse<{
    marked: number;
    totalAmount: number;
    items: Array<{ id: string; amount: number; paid_at: string }>;
  }>
> {
  try {
    const profile = await requireStaff();
    const supabase = await createClient();

    // Server-side validation, not just a client guard: the dialog is not
    // the boundary.
    //
    // Note this action previously wrote only paid_at + paid_by. That was
    // NOT rejected by payments_paid_complete — verified against the live
    // database — because the check only constrains rows whose status is
    // already PAID, and this payload left status at PENDING. The damage
    // was therefore silent rather than loud: a row whose money had moved
    // while it still read PENDING in every status filter, tab and total.
    // Status and the paid_* triple are written together for that reason.
    const validated = markPaidSchema.safeParse({
      payment_ids: paymentIds,
      method: paymentMethod,
      paid_on: paidOn,
      reference_number: referenceNumber,
      note: paymentNote,
    });
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid details" };
    }
    const { method, paid_on: paidOnDay } = validated.data;

    const { data: rows, error } = await supabase
      .from("payments")
      .select(
        `id, task_id, employee_id, description, amount, paid_at, payment_note,
         employee:profiles!payments_employee_id_fkey(full_name, email),
         task:tasks(id, title)`
      )
      .in("id", paymentIds)
      .is("paid_at", null);

    if (error) {
      console.error("[markPaymentsPaidBatch] load", error);
      return { success: false, error: "Failed to load the selected payments" };
    }

    type BatchRow = {
      id: string;
      task_id: string | null;
      // Selected by the query above and needed to key the per-employee
      // push, which is addressed by user id rather than email.
      employee_id: string | null;
      description: string | null;
      amount: number | string;
      payment_note: string | null;
      employee: { full_name: string; email: string }[] | { full_name: string; email: string } | null;
      task: { id: string; title: string }[] | { id: string; title: string } | null;
    };

    const payable = (rows ?? []) as unknown as BatchRow[];
    if (payable.length === 0) {
      return { success: false, error: "Those payments are already paid" };
    }

    // A chosen calendar day is anchored at midday IST rather than at
    // midnight, so the stored instant sits in the middle of the day
    // instead of 5.5 hours from its edge. For Asia/Kolkata a midnight-UTC
    // anchor happens to land on the same day, so this is robustness
    // rather than a live bug fix: any ledger timezone with a negative
    // offset would push a midnight anchor onto the previous day.
    const paidAt = paidOnDay
      ? new Date(`${paidOnDay}T12:00:00+05:30`).toISOString()
      : new Date().toISOString();
    const ids = payable.map((r) => r.id);
    const { error: updateError } = await supabase
      .from("payments")
      .update({
        status: "PAID",
        paid_at: paidAt,
        paid_by: profile.id,
        payment_method: method,
        ...(referenceNumber ? { reference_number: referenceNumber } : {}),
      })
      .in("id", ids);

    if (updateError) {
      console.error("[markPaymentsPaidBatch] update", updateError);
      return { success: false, error: "Couldn't mark the payments as paid" };
    }

    // Only append the note where one doesn't exist yet
    if (paymentNote) {
      await supabase
        .from("payments")
        .update({ payment_note: paymentNote })
        .in(
          "id",
          ids.filter((id) => {
            const row = payable.find((r) => r.id === id);
            return !!row && !row.payment_note;
          })
        );
    }

    const totalAmount = payable.reduce((sum, r) => sum + Number(r.amount), 0);

    // One email per employee, summarising their share of the batch
    const byEmail = new Map<
      string,
      { name: string; amount: number; count: number; firstLabel: string }
    >();
    for (const raw of payable) {
      const employee = one(raw.employee);
      if (!employee?.email) continue;
      const entry = byEmail.get(employee.email) ?? {
        name: employee.full_name,
        amount: 0,
        count: 0,
        firstLabel: raw.task_id ? (one(raw.task)?.title ?? "Task") : (raw.description ?? "Payment"),
      };
      entry.amount += Number(raw.amount);
      entry.count += 1;
      byEmail.set(employee.email, entry);
    }
    for (const [email, entry] of byEmail) {
      void sendEventEmail("PAYMENT_PAID", {
        to: email,
        employeeName: entry.name,
        taskTitle: entry.count === 1 ? entry.firstLabel : `${entry.count} payments`,
        amount: entry.amount,
        paymentNote,
      });
    }

    // §71 — one push per employee for the whole batch, matching the
    // email: a phone buzzing 30 times for one bulk action is worse than
    // useless.
    const pushedIds = new Set<string>();
    for (const raw of payable) {
      const employeeId = raw.employee_id;
      if (!employeeId || pushedIds.has(employeeId)) continue;
      pushedIds.add(employeeId);
      const employee = one(raw.employee);
      const own = payable.filter(
        (p: { employee_id: string | null }) => p.employee_id === employeeId
      );
      const total = own.reduce(
        (sum: number, p: { amount: number | string }) => sum + Number(p.amount),
        0
      );
      void notifyPaymentPaid(
        employeeId,
        own.length === 1
          ? (own[0].task_id ? (one(own[0].task)?.title ?? "Task") : (own[0].description ?? "Payment"))
          : `${own.length} payments`,
        total,
        null,
        employee?.full_name ?? null
      );
    }

    return {
      success: true,
      data: {
        marked: payable.length,
        totalAmount,
        items: payable.map((r) => ({ id: r.id, amount: Number(r.amount), paid_at: paidAt })),
      },
    };
  } catch (err) {
    console.error("[markPaymentsPaidBatch] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

/** §10 — lightweight note editing on any payment. */
export async function updatePaymentNote(
  paymentId: string,
  note: string
): Promise<ActionResponse<{ payment_note: string | null }>> {
  try {
    await requireStaff();
    const supabase = await createClient();

    const trimmed = note.trim();
    const { data, error } = await supabase
      .from("payments")
      .update({ payment_note: trimmed || null })
      .eq("id", paymentId)
      .select("payment_note")
      .single();

    if (error) {
      console.error("[updatePaymentNote]", error);
      return { success: false, error: "Couldn't save the note" };
    }

    return { success: true, data: { payment_note: (data as { payment_note: string | null }).payment_note } };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// §71 — Payment adjustments.
//
// A bonus or a deduction recorded against a payment that has already
// been paid. The ledger stays append-only: an adjustment is a NEW
// payments row pointing at its parent, never a mutation of the
// original, and reversing one means recording the opposite amount.
// That is what makes the history auditable — there is always a full
// trail of what was paid and every correction applied to it.
// ──────────────────────────────────────────────

export interface CreateAdjustmentInput {
  parent_payment_id: string;
  /** Signed: positive is a bonus, negative is a deduction. */
  amount: number;
  /** Required — this is what the employee sees and what makes the row auditable. */
  reason: string;
}

export async function createPaymentAdjustment(
  input: CreateAdjustmentInput
): Promise<ActionResponse<PaymentItem>> {
  try {
    const profile = await requireStaff();
    const supabase = await createClient();

    const reason = input.reason.trim();
    if (!reason) {
      return { success: false, error: "A reason is required for an adjustment" };
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return { success: false, error: "The adjustment amount must not be zero" };
    }

    // The parent must be a real, already-paid payment. Re-reading it
    // rather than trusting the client is what stops an adjustment being
    // attached to an unpaid row (where the admin can still edit the
    // amount before paying) or to something outside this workspace.
    const { data: parent, error: parentError } = await supabase
      .from("payments")
      .select(
        `id, task_id, employee_id, description, amount, amount_paise, status, type,
         payment_method, reference_number, due_date, paid_at, payment_note, created_at,
         kind, parent_payment_id,
         employee:profiles!payments_employee_id_fkey(full_name, email),
         task:tasks(id, title)`
      )
      .eq("id", input.parent_payment_id)
      .maybeSingle();

    if (parentError) {
      console.error("[createPaymentAdjustment] parent", parentError);
      return { success: false, error: "Failed to load that payment" };
    }
    if (!parent) {
      return { success: false, error: "Payment not found" };
    }
    if (!parent.paid_at) {
      return {
        success: false,
        error: "Only a paid payment can be adjusted — edit the amount before marking it paid",
      };
    }
    // No daisy chains: an adjustment always points at the original
    // payment. Applying a second correction means targeting the same
    // parent, which is what the UI does.
    if ((parent.kind ?? "PAYMENT") !== "PAYMENT") {
      return {
        success: false,
        error: "Adjustments attach to the original payment, not to another adjustment",
      };
    }
    if (!parent.employee_id) {
      return {
        success: false,
        error: "This payment has no employee, so it can't be adjusted",
      };
    }

    const parentRow = parent as unknown as PaymentLedgerRow;
    const employee = one(
      (parent as unknown as { employee: { full_name: string; email: string }[] | { full_name: string; email: string } | null }).employee
    );

    const { data: created, error: insertError } = await supabase
      .from("payments")
      .insert({
        task_id: parent.task_id,
        employee_id: parent.employee_id,
        payee: parent.employee_id,
        created_by: profile.id,
        // Signed paise: positive bonus, negative deduction. This is why
        // the DB constraint is scoped to kind = 'PAYMENT'.
        amount_paise: toPaise(amount),
        amount,
        type: "ADJUSTMENT",
        status: "PAID",
        payment_method: "OTHER",
        paid_at: new Date().toISOString(),
        paid_by: profile.id,
        payment_note: reason,
        description: reason,
        kind: "ADJUSTMENT",
        parent_payment_id: parent.id,
      })
      .select("id, created_at")
      .single();

    if (insertError || !created) {
      console.error("[createPaymentAdjustment] insert", insertError);
      return { success: false, error: "Couldn't record the adjustment" };
    }

    if (employee?.email) {
      const bonus = amount > 0;
      void sendEventEmail("PAYMENT_PAID", {
        to: employee.email,
        employeeName: employee.full_name,
        taskTitle: parentRow.task?.title ?? parentRow.description ?? "Payment",
        amount,
        paymentNote: `${bonus ? "Bonus" : "Deduction"}: ${reason}`,
      });
    }

    // §71 — an adjustment is the one payment event the employee has no
    // other way to hear about: the original payment was already paid and
    // emailed days earlier, so without this the bonus lands silently.
    // (The early guard above already rejected a null employee_id, but
    // the row type stays nullable, so narrow it here.)
    if (parentRow.employee_id) {
      void notifyAdjustmentRecorded(
        parentRow.employee_id,
        amount,
        reason,
        employee?.full_name ?? null
      );
    }

    // Return the adjustment as a PaymentItem so the client can patch the
    // parent row without a refetch. The parent is untouched — only this
    // new row exists, so its own base/net are the adjustment itself.
    return {
      success: true,
      data: {
        id: (created as { id: string }).id,
        kind: parentRow.task_id ? "TASK" : "CUSTOM",
        employee_id: parentRow.employee_id,
        employee_name: employee?.full_name ?? null,
        employee_email: employee?.email ?? null,
        task_id: parentRow.task_id,
        label: parentRow.task_id
          ? (parentRow.task?.title ?? "Task")
          : (parentRow.description ?? "Custom payment"),
        project_name: null,
        client_name: null,
        amount,
        base_amount: amount,
        adjustment_total: 0,
        adjustments: [],
        status: "PAID",
        paid_at: new Date().toISOString(),
        payment_note: reason,
        created_at: (created as { created_at: string }).created_at,
        // Signed: the client's applyAdjustmentToItem adds this to the
        // parent's paise, so a negative deduction reduces the net.
        amount_paise: toPaise(amount),
        base_amount_paise: toPaise(amount),
        type: "ADJUSTMENT",
        method: "OTHER",
        reference_number: null,
        due_date: null,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}


// ──────────────────────────────────────────────
// §71 — "you were paid" delivery.
//
// Every payment path already emailed. This adds the phone ping, and it
// goes through createNotification rather than sendPushToUser directly so
// the payment also lands in the in-app notification centre — one code
// path, two channels, and the employee sees it whether or not push is
// configured.
//
// Fire-and-forget throughout: a push failure must never turn a completed
// payment into an error the admin has to reason about.
// ──────────────────────────────────────────────

async function notifyPaymentPaid(
  employeeId: string,
  label: string,
  amount: number,
  taskId: string | null,
  employeeName?: string | null
): Promise<void> {
  try {
    await createNotification({
      userId: employeeId,
      type: "PAYMENT_PAID",
      title: "Payment received",
      message: `${employeeName ? `${employeeName}, ` : ""}you were paid ${formatCurrency(amount)} for ${label}`,
      // A task-linked payment deep-links to the task; a custom payment
      // has nowhere better to go than the payments workspace.
      referenceType: taskId ? "task" : "payment",
      referenceId: taskId,
    });
  } catch (err) {
    console.error("[notifyPaymentPaid]", err);
  }
}


/**
 * §71 — announce a bonus or deduction.
 *
 * Routed through createNotification so the adjustment also appears in the
 * in-app notification centre, and tagged distinctly from an ordinary
 * payment so the wording is honest ("bonus", not "payment received").
 */
async function notifyAdjustmentRecorded(
  employeeId: string,
  amount: number,
  reason: string,
  employeeName: string | null
): Promise<void> {
  try {
    const bonus = amount > 0;
    await createNotification({
      userId: employeeId,
      type: "PAYMENT_PAID",
      title: bonus ? "Bonus added" : "Deduction applied",
      message: `${employeeName ? `${employeeName}, ` : ""}${bonus ? "+" : "\u2212"}${formatCurrency(Math.abs(amount))} \u2014 ${reason}`,
      referenceType: "payment",
      referenceId: null,
    });
  } catch (err) {
    console.error("[notifyAdjustmentRecorded]", err);
  }
}
