"use server";

import { createClient } from "@/lib/supabase/server";
import { requireStaff, requireActiveUser } from "@/lib/auth";
import { canManageProfile } from "@/lib/permissions";
import type { ActionResponse, Profile, UserRole } from "@/types/database";

export interface TeamMember extends Profile {
  active_tasks: number;
  projects_count: number;
  /** §15 — workload snapshot for the admin employees overview */
  overdue_tasks: number;
  awaiting_review: number;
  pending_payment: number;
}

export async function getTeamMembers(): Promise<ActionResponse<TeamMember[]>> {
  try {
    await requireStaff();
    const supabase = await createClient();
    const now = Date.now();
    const [{ data: profiles, error }, { data: tasks }, { data: memberships }, { data: pendingPayments }] =
      await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("tasks").select("assigned_to, status, deadline").not("status", "eq", "COMPLETED"),
        supabase.from("project_members").select("user_id"),
        supabase.from("payments").select("employee_id, amount").is("paid_at", null),
      ]);

    if (error) return { success: false, error: "Failed to load team" };

    const activeTasks = new Map<string, number>();
    const overdueTasks = new Map<string, number>();
    const awaitingReview = new Map<string, number>();
    for (const task of tasks ?? []) {
      if (!task.assigned_to) continue;
      activeTasks.set(task.assigned_to, (activeTasks.get(task.assigned_to) ?? 0) + 1);
      if (task.status === "SUBMITTED") {
        awaitingReview.set(task.assigned_to, (awaitingReview.get(task.assigned_to) ?? 0) + 1);
      } else if (task.deadline && new Date(task.deadline).getTime() < now) {
        overdueTasks.set(task.assigned_to, (overdueTasks.get(task.assigned_to) ?? 0) + 1);
      }
    }
    const projects = new Map<string, number>();
    for (const membership of memberships ?? []) {
      projects.set(membership.user_id, (projects.get(membership.user_id) ?? 0) + 1);
    }
    const pendingPayment = new Map<string, number>();
    for (const p of pendingPayments ?? []) {
      if (!p.employee_id) continue;
      pendingPayment.set(p.employee_id, (pendingPayment.get(p.employee_id) ?? 0) + Number(p.amount));
    }

    return {
      success: true,
      data: (profiles ?? []).map((profile) => ({
        ...(profile as Profile),
        active_tasks: activeTasks.get(profile.id) ?? 0,
        projects_count: projects.get(profile.id) ?? 0,
        overdue_tasks: overdueTasks.get(profile.id) ?? 0,
        awaiting_review: awaitingReview.get(profile.id) ?? 0,
        pending_payment: pendingPayment.get(profile.id) ?? 0,
      })),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function manageProfileAction(
  targetId: string,
  action: "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "ROLE_CHANGED",
  role?: UserRole
): Promise<ActionResponse<Profile>> {
  try {
    const actor = await requireStaff();
    const supabase = await createClient();

    // Authorize BEFORE the RPC, against the target's CURRENT role.
    //
    // This check is not redundant with manage_profile_lifecycle(): the
    // RPC is SECURITY DEFINER and the one authoritative gate, but it
    // only sees the row it is about to write. Checking here too means
    // an unauthorized attempt returns a normal ActionResponse.error
    // (rather than a thrown Postgres error string) and cannot be
    // reached at all from a manager's client.
    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", targetId)
      .maybeSingle();

    if (targetError) {
      return { success: false, error: "Failed to load team member" };
    }
    if (!target) {
      return { success: false, error: "Team member not found" };
    }

    if (
      !canManageProfile(
        actor.role,
        (target.role as UserRole | null) ?? null,
        action,
        role ?? null
      )
    ) {
      return {
        success: false,
        error:
          action === "ROLE_CHANGED"
            ? "Only a super admin can change a role"
            : "You can only manage employees",
      };
    }

    const { data, error } = await supabase
      .rpc("manage_profile_lifecycle", {
        target_id: targetId,
        requested_action: action,
        requested_role: role ?? null,
      })
      .single();

    if (error || !data) {
      console.error("[manageProfileAction]", error);
      return { success: false, error: error?.message ?? "Failed to update team member" };
    }

    return { success: true, data: data as Profile };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export interface EmployeeWithWorkload {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  phone: string | null;
  active: boolean;
  active_tasks: number;
  due_today: number;
  pending_payout: number;
}

/** Admin: compact employee list with workload numbers (§24) */
export async function getEmployeesWithWorkload(): Promise<
  ActionResponse<EmployeeWithWorkload[]>
> {
  try {
    await requireStaff();
    const supabase = await createClient();

    const { data: employees, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url, phone, active")
      .eq("role", "EMPLOYEE")
      .order("full_name");

    if (error) {
      console.error("[getEmployeesWithWorkload]", error);
      return { success: false, error: "Failed to load employees" };
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [{ data: tasks }, { data: payments }] = await Promise.all([
      supabase
        .from("tasks")
        .select("assigned_to, deadline, status, payment_status, payout_amount")
        .not("status", "in", '("COMPLETED")'),
      supabase
        .from("tasks")
        .select("assigned_to, payment_status, payout_amount")
        .eq("payment_status", "PENDING")
        .gt("payout_amount", 0),
    ]);

    const stats = new Map<
      string,
      { active: number; dueToday: number; pending: number }
    >();
    (employees ?? []).forEach((e: { id: string }) =>
      stats.set(e.id, { active: 0, dueToday: 0, pending: 0 })
    );

    (tasks ?? []).forEach(
      (t: {
        assigned_to: string | null;
        deadline: string | null;
        payment_status: string;
        payout_amount: number;
      }) => {
        if (!t.assigned_to || !stats.has(t.assigned_to)) return;
        const s = stats.get(t.assigned_to)!;
        s.active += 1;
        if (
          t.deadline &&
          t.deadline >= startOfToday.toISOString() &&
          t.deadline <= endOfToday.toISOString()
        ) {
          s.dueToday += 1;
        }
      }
    );

    (payments ?? []).forEach(
      (t: { assigned_to: string | null; payout_amount: number }) => {
        if (!t.assigned_to || !stats.has(t.assigned_to)) return;
        stats.get(t.assigned_to)!.pending += Number(t.payout_amount);
      }
    );

    return {
      success: true,
      data: (employees ?? []).map(
        (e: {
          id: string;
          full_name: string;
          email: string;
          avatar_url: string | null;
          phone: string | null;
          active: boolean;
        }) => ({
          ...e,
          active_tasks: stats.get(e.id)?.active ?? 0,
          due_today: stats.get(e.id)?.dueToday ?? 0,
          pending_payout: stats.get(e.id)?.pending ?? 0,
        })
      ),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export interface EmployeeProfileDetail {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
  active_tasks: Array<{
    id: string;
    title: string;
    status: string;
    deadline: string | null;
    project_name: string | null;
  }>;
  completed_count: number;
  pending_payout: number;
  recent_work: Array<{
    id: string;
    title: string;
    status: string;
    completed_at: string | null;
  }>;
}

/** Admin: single employee profile with workload detail (§24) */
export async function getEmployeeProfile(
  id: string
): Promise<ActionResponse<EmployeeProfileDetail>> {
  try {
    await requireStaff();
    const supabase = await createClient();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Both reads key off the `id` argument, so they are issued together
    // rather than the task list waiting on the profile round-trip.
    const employeePromise = supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url, phone, active, created_at")
      .eq("id", id)
      .single();

    const tasksPromise = supabase
      .from("tasks")
      .select(
        "id, title, status, deadline, completed_at, project:projects(name), payment_status, payout_amount"
      )
      .eq("assigned_to", id)
      .order("created_at", { ascending: false })
      .limit(100);

    const [{ data: employee, error }, { data: tasks }] = await Promise.all([
      employeePromise,
      tasksPromise,
    ]);

    if (error || !employee) {
      return { success: false, error: "Employee not found" };
    }

    const all = tasks ?? [];
    const active = all.filter(
      (t: { status: string }) => t.status !== "COMPLETED"
    );
    const completed = all.filter(
      (t: { status: string; completed_at: string | null }) =>
        t.status === "COMPLETED"
    );

    const pending = all
      .filter(
        (t: { payment_status: string; payout_amount: number }) =>
          t.payment_status === "PENDING" && Number(t.payout_amount) > 0
      )
      .reduce(
        (sum: number, t: { payout_amount: number }) =>
          sum + Number(t.payout_amount),
        0
      );

    return {
      success: true,
      data: {
        ...(employee as {
          id: string;
          full_name: string;
          email: string;
          avatar_url: string | null;
          phone: string | null;
          active: boolean;
          created_at: string;
        }),
        active_tasks: active
          .slice(0, 10)
          .map(
            (t: {
              id: string;
              title: string;
              status: string;
              deadline: string | null;
              project: { name: string }[] | { name: string } | null;
            }) => {
              const p = Array.isArray(t.project)
                ? t.project[0]
                : t.project;
              return {
                id: t.id,
                title: t.title,
                status: t.status,
                deadline: t.deadline,
                project_name: p?.name ?? null,
              };
            }
          ),
        completed_count: completed.filter(
          (t: { completed_at: string | null }) =>
            t.completed_at && t.completed_at >= startOfMonth.toISOString()
        ).length,
        pending_payout: pending,
        recent_work: completed.slice(0, 8).map((t: { id: string; title: string; status: string; completed_at: string | null }) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          completed_at: t.completed_at,
        })),
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Any authenticated user: ACTIVE employees for dropdowns (§49) */
export async function getActiveEmployees(): Promise<
  ActionResponse<Array<{ id: string; full_name: string; avatar_url: string | null }>>
> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("role", "EMPLOYEE")
      .eq("status", "ACTIVE")
      .order("full_name");

    if (error) {
      return { success: false, error: "Failed to load employees" };
    }
    return { success: true, data: data ?? [] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
