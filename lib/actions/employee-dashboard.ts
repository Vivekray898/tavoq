"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import type { ActionResponse, Task } from "@/types/database";

export interface EmployeeDashboardStats {
  dueToday: number;
  needsReview: number;
  completed: number;
  pendingPayment: number;
}

/**
 * Stats for the currently logged-in employee only.
 */
export async function getEmployeeDashboardStats(): Promise<
  ActionResponse<EmployeeDashboardStats>
> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dueTodayRes, needsReviewRes, completedRes, pendingPayRes, paidMonthRes] =
      await Promise.all([
        // Due today (not yet done)
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("assigned_to", profile.id)
          .gte("deadline", startOfToday.toISOString())
          .lte("deadline", endOfToday.toISOString())
          .not("status", "in", '("COMPLETED","APPROVED")'),

        // Submitted, awaiting admin review
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("assigned_to", profile.id)
          .eq("status", "SUBMITTED"),

        // Completed this month (APPROVED or COMPLETED)
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("assigned_to", profile.id)
          .in("status", ["APPROVED", "COMPLETED"])
          .gte("completed_at", startOfMonth.toISOString()),

        // Pending payment amount
        supabase
          .from("tasks")
          .select("payout_amount")
          .eq("assigned_to", profile.id)
          .eq("payment_status", "PENDING"),

        // Paid this month (just for reference — not currently shown)
        supabase
          .from("payments")
          .select("amount, task:tasks!inner(assigned_to)")
          .eq("task.assigned_to", profile.id)
          .gte("paid_at", startOfMonth.toISOString()),
      ]);

    const pendingPayment = (pendingPayRes.data ?? []).reduce(
      (sum, t) => sum + Number(t.payout_amount ?? 0),
      0
    );

    return {
      success: true,
      data: {
        dueToday: dueTodayRes.count ?? 0,
        needsReview: needsReviewRes.count ?? 0,
        completed: completedRes.count ?? 0,
        pendingPayment,
      },
    };
  } catch (err) {
    console.error("[getEmployeeDashboardStats] error:", err);
    return { success: false, error: "Failed to load stats" };
  }
}

/**
 * The employee's active tasks (not yet completed/approved), sorted by deadline.
 */
export async function getMyActiveTasks(
  limit = 10
): Promise<ActionResponse<Task[]>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("assigned_to", profile.id)
      .not("status", "in", '("COMPLETED","APPROVED")')
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) {
      console.error("[getMyActiveTasks] error:", error);
      return { success: false, error: "Failed to load tasks" };
    }

    return { success: true, data: (data ?? []) as Task[] };
  } catch (err) {
    console.error("[getMyActiveTasks] error:", err);
    return { success: false, error: "Failed to load tasks" };
  }
}