"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActiveAdmin, requireAuth } from "@/lib/auth";
import type { ActionResponse } from "@/types/database";

// ──────────────────────────────────────────────
// Admin dashboard (§9)
// ──────────────────────────────────────────────

export interface AdminDashboardData {
  counts: {
    due_today: number;
    needs_review: number;
    overdue: number;
    pending_payments: number;
    pending_approvals: number;
  };
  needs_attention: Array<{
    id: string;
    kind: "SUBMITTED" | "OVERDUE";
    title: string;
    subtitle: string;
    actor_name: string | null;
    created_at: string | null;
    deadline: string | null;
  }>;
  todays_work: Array<{
    id: string;
    title: string;
    status: string;
    deadline: string | null;
    priority: string;
    assigned_name: string | null;
    project_name: string | null;
  }>;
  recent_activity: Array<{
    id: string;
    kind: "comment" | "submitted" | "completed" | "created" | "payment";
    title: string;
    detail: string | null;
    created_at: string;
  }>;
}

export async function getAdminDashboard(): Promise<
  ActionResponse<AdminDashboardData>
> {
  try {
    await requireActiveAdmin();
    const supabase = await createClient();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const startIso = startOfToday.toISOString();
    const endIso = endOfToday.toISOString();

    const [
      dueTodayRes,
      reviewRes,
      overdueRes,
      submittedRes,
      todaysRes,
      pendingPayRes,
      pendingApprovalsRes,
      activityRes,
    ] =
      await Promise.all([
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .gte("deadline", startIso)
          .lte("deadline", endIso)
          .not("status", "in", '("COMPLETED")'),
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("status", "SUBMITTED"),
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .lt("deadline", startIso)
          .not("status", "in", '("COMPLETED")'),
        // Needs attention: submitted tasks with submitter
        supabase
          .from("tasks")
          .select(
            "id, title, updated_at, assigned_user:profiles!tasks_assigned_to_fkey(full_name)"
          )
          .eq("status", "SUBMITTED")
          .order("updated_at", { ascending: false })
          .limit(6),
        // Today's work: due today or overdue, active
        supabase
          .from("tasks")
          .select(
            "id, title, status, deadline, priority, assigned_user:profiles!tasks_assigned_to_fkey(full_name), project:projects(name)"
          )
          .not("status", "in", '("COMPLETED")')
          .or(`deadline.lte.${endIso},deadline.gte.${startIso}`)
          .order("deadline", { ascending: true, nullsFirst: false })
          .limit(8),
        // §6 — real counters, never hardcoded: pending payment rows
        supabase
          .from("payments")
          .select("amount")
          .is("paid_at", null),
        // PENDING employee account approvals
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "EMPLOYEE")
          .eq("status", "PENDING"),
        // Recent activity: comments + recent task updates
        supabase
          .from("task_comments")
          .select(
            "id, comment, created_at, user:profiles(full_name), task:tasks(id, title)"
          )
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

    const needs_attention: AdminDashboardData["needs_attention"] = (
      submittedRes.data ?? []
    ).map(
      (row: {
        id: string;
        title: string;
        updated_at: string;
        assigned_user: { full_name: string }[] | { full_name: string } | null;
      }) => {
        const u = Array.isArray(row.assigned_user)
          ? row.assigned_user[0]
          : row.assigned_user;
        return {
          id: row.id,
          kind: "SUBMITTED" as const,
          title: `${u?.full_name ?? "Someone"} submitted`,
          subtitle: row.title,
          actor_name: u?.full_name ?? null,
          created_at: row.updated_at,
          deadline: null,
        };
      }
    );

    // Overdue tasks also need attention
    const { data: overdueTasks } = await supabase
      .from("tasks")
      .select("id, title, deadline, assigned_user:profiles!tasks_assigned_to_fkey(full_name)")
      .lt("deadline", startIso)
      .not("status", "in", '("COMPLETED")')
      .order("deadline", { ascending: true })
      .limit(4);

    (overdueTasks ?? []).forEach(
      (row: {
        id: string;
        title: string;
        deadline: string;
        assigned_user: { full_name: string }[] | { full_name: string } | null;
      }) => {
        const u = Array.isArray(row.assigned_user)
          ? row.assigned_user[0]
          : row.assigned_user;
        needs_attention.push({
          id: row.id,
          kind: "OVERDUE",
          title: `${u?.full_name ?? "Unassigned"}'s task is overdue`,
          subtitle: row.title,
          actor_name: u?.full_name ?? null,
          created_at: null,
          deadline: row.deadline,
        });
      }
    );

    const todays_work = (todaysRes.data ?? []).map(
      (row: {
        id: string;
        title: string;
        status: string;
        deadline: string | null;
        priority: string;
        assigned_user: { full_name: string }[] | { full_name: string } | null;
        project: { name: string }[] | { name: string } | null;
      }) => {
        const u = Array.isArray(row.assigned_user)
          ? row.assigned_user[0]
          : row.assigned_user;
        const p = Array.isArray(row.project) ? row.project[0] : row.project;
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          deadline: row.deadline,
          priority: row.priority,
          assigned_name: u?.full_name ?? null,
          project_name: p?.name ?? null,
        };
      }
    );

    const recent_activity = (activityRes.data ?? []).map(
      (row: {
        id: string;
        comment: string;
        created_at: string;
        user: { full_name: string }[] | { full_name: string } | null;
        task: { id: string; title: string }[] | { id: string; title: string } | null;
      }) => {
        const u = Array.isArray(row.user) ? row.user[0] : row.user;
        const t = Array.isArray(row.task) ? row.task[0] : row.task;
        return {
          id: `comment-${row.id}`,
          kind: "comment" as const,
          title: `${u?.full_name ?? "Someone"} commented`,
          detail: t ? `${t.title} — ${row.comment.slice(0, 60)}` : row.comment.slice(0, 60),
          created_at: row.created_at,
        };
      }
    );

    return {
      success: true,
      data: {
        counts: {
          due_today: dueTodayRes.count ?? 0,
          needs_review: reviewRes.count ?? 0,
          overdue: overdueRes.count ?? 0,
          pending_payments: (
            (pendingPayRes.data ?? []) as Array<{ amount: number | string }>
          ).reduce((sum: number, row) => sum + Number(row.amount), 0),
          pending_approvals: pendingApprovalsRes.count ?? 0,
        },
        needs_attention,
        todays_work,
        recent_activity,
      },
    };
  } catch {
    return { success: false, error: "Failed to load dashboard" };
  }
}

// ──────────────────────────────────────────────
// Employee dashboard (§10)
// ──────────────────────────────────────────────

export interface EmployeeDashboardData {
  due_today_count: number;
  due_today: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    deadline: string | null;
    payout_amount: number;
    payment_status: string;
    project_name: string | null;
  }>;
  upcoming: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    deadline: string | null;
    payout_amount: number;
    project_name: string | null;
  }>;
  waiting_review: Array<{
    id: string;
    title: string;
    submitted_at: string | null;
    project_name: string | null;
  }>;
  recently_completed: Array<{
    id: string;
    title: string;
    completed_at: string | null;
    payment_status: string;
    payout_amount: number;
  }>;
}

export async function getEmployeeDashboard(): Promise<
  ActionResponse<EmployeeDashboardData>
> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const startIso = startOfToday.toISOString();
    const endIso = endOfToday.toISOString();

    const { data: tasks, error } = await supabase
      .from("tasks")
      .select(
        "id, title, status, priority, deadline, payout_amount, payment_status, completed_at, updated_at, project:projects(name)"
      )
      .eq("assigned_to", profile.id)
      .not("status", "in", '("COMPLETED")')
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(50);

    if (error) {
      console.error("[getEmployeeDashboard]", error);
      return { success: false, error: "Failed to load your tasks" };
    }

    const { data: completedTasks } = await supabase
      .from("tasks")
      .select(
        "id, title, completed_at, payment_status, payout_amount, project:projects(name)"
      )
      .eq("assigned_to", profile.id)
      .eq("status", "COMPLETED")
      .order("completed_at", { ascending: false })
      .limit(5);

    const mapProject = (row: { project: { name: string }[] | { name: string } | null }) => {
      const p = Array.isArray(row.project) ? row.project[0] : row.project;
      return p?.name ?? null;
    };

    const rows = (tasks ?? []).map((row) => row as never) as Array<
      typeof tasks extends (infer T)[] | null ? T : never
    >;

    const due_today = rows
      .filter(
        (t) =>
          t.deadline && t.deadline >= startIso && t.deadline <= endIso
      )
      .slice(0, 6)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        payout_amount: Number(t.payout_amount),
        payment_status: t.payment_status as string,
        project_name: mapProject(t),
      }));

    const upcoming = rows
      .filter((t) => !t.deadline || t.deadline > endIso)
      .slice(0, 6)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        payout_amount: Number(t.payout_amount),
        project_name: mapProject(t),
      }));

    const waiting_review = rows
      .filter((t) => t.status === "SUBMITTED")
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        title: t.title,
        submitted_at: t.updated_at,
        project_name: mapProject(t),
      }));

    const recently_completed = (completedTasks ?? []).map(
      (row: {
        id: string;
        title: string;
        completed_at: string | null;
        payment_status: string;
        payout_amount: number;
      }) => ({
        id: row.id,
        title: row.title,
        completed_at: row.completed_at,
        payment_status: row.payment_status,
        payout_amount: Number(row.payout_amount),
      })
    );

    return {
      success: true,
      data: {
        due_today_count: due_today.length,
        due_today,
        upcoming,
        waiting_review,
        recently_completed,
      },
    };
  } catch {
    return { success: false, error: "Failed to load dashboard" };
  }
}

// ──────────────────────────────────────────────
// Global search (§52)
// ──────────────────────────────────────────────

export interface SearchResult {
  tasks: Array<{ id: string; title: string; project_name: string | null }>;
  projects: Array<{ id: string; name: string; client_name: string | null }>;
  clients: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; full_name: string; email: string }>;
}

export async function globalSearch(query: string): Promise<ActionResponse<SearchResult>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();
    const q = query.trim();
    if (q.length < 2) {
      return { success: true, data: { tasks: [], projects: [], clients: [], employees: [] } };
    }
    const like = `%${q}%`;

    let taskQuery = supabase
      .from("tasks")
      .select("id, title, project:projects(name)")
      .ilike("title", like)
      .limit(6);

    if (profile.role === "EMPLOYEE") {
      taskQuery = taskQuery.eq("assigned_to", profile.id);
    }

    let projectQuery = supabase
      .from("projects")
      .select("id, name, client:clients(name)")
      .ilike("name", like)
      .neq("status", "ARCHIVED")
      .limit(5);

    if (profile.role === "EMPLOYEE") {
      const { data: memberProjects } = await supabase
        .from("project_members")
        .select("project_id")
        .eq("user_id", profile.id);
      const ids = memberProjects?.map((m) => m.project_id) ?? [];
      if (ids.length === 0) {
        return { success: true, data: { tasks: [], projects: [], clients: [], employees: [] } };
      }
      projectQuery = projectQuery.in("id", ids);
    }

    const [tasksRes, projectsRes, clientsRes, employeesRes] = await Promise.all([
      taskQuery,
      projectQuery,
      profile.role === "ADMIN"
        ? supabase.from("clients").select("id, name").ilike("name", like).limit(4)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      // Employees are only searchable by admins (RLS matches this)
      profile.role === "ADMIN"
        ? supabase
            .from("profiles")
            .select("id, full_name, email")
            .eq("role", "EMPLOYEE")
            .eq("status", "ACTIVE")
            .or(`full_name.ilike.${like},email.ilike.${like}`)
            .limit(4)
        : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
    ]);

    return {
      success: true,
      data: {
        tasks: (tasksRes.data ?? []).map(
          (t: { id: string; title: string; project: { name: string }[] | { name: string } | null }) => {
            const p = Array.isArray(t.project) ? t.project[0] : t.project;
            return { id: t.id, title: t.title, project_name: p?.name ?? null };
          }
        ),
        projects: (projectsRes.data ?? []).map(
          (p: { id: string; name: string; client: { name: string }[] | null }) => ({
            id: p.id,
            name: p.name,
            client_name: p.client?.[0]?.name ?? null,
          })
        ),
        clients: (clientsRes as { data: { id: string; name: string }[] | null }).data ?? [],
        employees: (employeesRes as { data: { id: string; full_name: string; email: string }[] | null })
          .data ?? [],
      },
    };
  } catch {
    return { success: false, error: "Search failed" };
  }
}
