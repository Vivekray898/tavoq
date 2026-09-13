"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import type { ActionResponse } from "@/types/database";

export interface AdminDashboardStats {
  activeProjects: number;
  activeTasks: number;
  dueToday: number;
  overdue: number;
  needsReview: number;
  pendingPayments: number;
  paidThisMonth: number;
}

export interface UpcomingDeadline {
  id: string;
  title: string;
  deadline: string;
  project_id: string;
  project_name: string;
  assigned_to: string | null;
  assigned_name: string | null;
  priority: string;
  status: string;
}

export interface RecentActivity {
  id: string;
  type: "comment" | "task_created" | "task_completed" | "payment";
  title: string;
  description: string;
  created_at: string;
  user_name: string | null;
}

export async function getAdminDashboardStats(): Promise<
  ActionResponse<AdminDashboardStats>
> {
  try {
    await requireAuth();
    const supabase = await createClient();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      activeProjectsRes,
      activeTasksRes,
      dueTodayRes,
      overdueRes,
      needsReviewRes,
      pendingPaymentsRes,
      paidThisMonthRes,
    ] = await Promise.all([
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .eq("status", "ACTIVE"),

      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .in("status", ["TODO", "IN_PROGRESS", "REVISION_REQUIRED"]),

      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .gte("deadline", startOfToday.toISOString())
        .lte("deadline", endOfToday.toISOString())
        .not("status", "in", '("COMPLETED","APPROVED")'),

      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .lt("deadline", startOfToday.toISOString())
        .not("status", "in", '("COMPLETED","APPROVED")'),

      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("status", "SUBMITTED"),

      supabase
        .from("tasks")
        .select("payout_amount")
        .eq("payment_status", "PENDING"),

      supabase
        .from("payments")
        .select("amount")
        .gte("paid_at", startOfMonth.toISOString()),
    ]);

    const pendingPayments = (pendingPaymentsRes.data ?? []).reduce(
      (sum, t) => sum + Number(t.payout_amount ?? 0),
      0
    );
    const paidThisMonth = (paidThisMonthRes.data ?? []).reduce(
      (sum, p) => sum + Number(p.amount ?? 0),
      0
    );

    return {
      success: true,
      data: {
        activeProjects: activeProjectsRes.count ?? 0,
        activeTasks: activeTasksRes.count ?? 0,
        dueToday: dueTodayRes.count ?? 0,
        overdue: overdueRes.count ?? 0,
        needsReview: needsReviewRes.count ?? 0,
        pendingPayments,
        paidThisMonth,
      },
    };
  } catch (err) {
    console.error("[getAdminDashboardStats] error:", err);
    return { success: false, error: "Failed to load dashboard stats" };
  }
}

export async function getUpcomingDeadlines(
  limit = 5
): Promise<ActionResponse<UpcomingDeadline[]>> {
  try {
    await requireAuth();
    const supabase = await createClient();

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("tasks")
      .select(
        `
        id, title, deadline, project_id, assigned_to, priority, status,
        project:projects(name),
        assigned_user:profiles(id, full_name)
      `
      )
      .gte("deadline", now)
      .not("status", "in", '("COMPLETED","APPROVED")')
      .order("deadline", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("[getUpcomingDeadlines] error:", error);
      return { success: false, error: "Failed to load deadlines" };
    }

    const deadlines: UpcomingDeadline[] = (data ?? []).map((row: any) => ({
      id: row.id,
      title: row.title,
      deadline: row.deadline,
      project_id: row.project_id,
      project_name: row.project?.name ?? "—",
      assigned_to: row.assigned_to,
      assigned_name: row.assigned_user?.full_name ?? null,
      priority: row.priority,
      status: row.status,
    }));

    return { success: true, data: deadlines };
  } catch (err) {
    console.error("[getUpcomingDeadlines] error:", err);
    return { success: false, error: "Failed to load deadlines" };
  }
}

export async function getRecentActivity(
  limit = 8
): Promise<ActionResponse<RecentActivity[]>> {
  try {
    await requireAuth();
    const supabase = await createClient();

    // Pull recent comments + recent task creations, merge, sort, slice
    const [commentsRes, tasksRes] = await Promise.all([
      supabase
        .from("task_comments")
        .select(
          `
          id, comment, created_at,
          user:profiles(full_name),
          task:tasks(title)
        `
        )
        .order("created_at", { ascending: false })
        .limit(limit),

      supabase
        .from("tasks")
        .select(
          `
          id, title, created_at, status,
          created_user:profiles!tasks_created_by_fkey(full_name)
        `
        )
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const items: RecentActivity[] = [];

    (commentsRes.data ?? []).forEach((c: any) => {
      items.push({
        id: `comment-${c.id}`,
        type: "comment",
        title: "New comment",
        description: `On "${c.task?.title ?? "task"}": ${
          (c.comment ?? "").slice(0, 80)
        }${(c.comment ?? "").length > 80 ? "…" : ""}`,
        created_at: c.created_at,
        user_name: c.user?.full_name ?? null,
      });
    });

    (tasksRes.data ?? []).forEach((t: any) => {
      items.push({
        id: `task-${t.id}`,
        type: t.status === "COMPLETED" || t.status === "APPROVED"
          ? "task_completed"
          : "task_created",
        title:
          t.status === "COMPLETED" || t.status === "APPROVED"
            ? "Task completed"
            : "New task created",
        description: t.title,
        created_at: t.created_at,
        user_name: t.created_user?.full_name ?? null,
      });
    });

    items.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return { success: true, data: items.slice(0, limit) };
  } catch (err) {
    console.error("[getRecentActivity] error:", err);
    return { success: false, error: "Failed to load activity" };
  }
}