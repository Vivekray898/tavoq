"use client";

import { queryOptions } from "@tanstack/react-query";
import {
  getTasks,
  getTask,
  type TaskListItem,
  type TaskDetail,
} from "@/lib/actions/tasks";
import {
  getProjects,
  getProject,
  type ProjectDetail,
} from "@/lib/actions/projects";
import {
  getClients,
  getClient,
  type ClientDetail,
} from "@/lib/actions/clients";
import {
  getTeamMembers,
  getEmployeeProfile,
  getActiveEmployees,
  type TeamMember,
  type EmployeeProfileDetail,
} from "@/lib/actions/employees";
import {
  getMyEarnings,
  getPaymentWorkspace,
  getEmployeePayableTasks,
  type EarningsData,
  type PaymentWorkspaceData,
  type PayableTask,
} from "@/lib/actions/payments";
import {
  getAdminDashboard,
  getEmployeeDashboard,
  type AdminDashboardData,
  type EmployeeDashboardData,
} from "@/lib/actions/dashboard";
import { getLabels, getSavedFilters, type SavedFilterRow } from "@/lib/actions/task-extras";
import { getNotifications } from "@/lib/actions/notifications";
import { getTaskActivity, getProjectActivity, type ActivityItem } from "@/lib/actions/activity";
import { getProjectsForTask } from "@/lib/actions/tasks";
import { getMyProfile } from "@/lib/actions/session";
import { getActiveClients } from "@/lib/actions/clients";
import type { Notification, Label, Profile } from "@/types/database";
import { qk } from "@/lib/queries/keys";

// ──────────────────────────────────────────────
// Cached, typed query options around the existing
// server actions. The actions remain the single
// source of truth for auth + business rules.
// ──────────────────────────────────────────────

export const taskListOptions = queryOptions<TaskListItem[]>({
  queryKey: qk.tasks(),
  queryFn: async () => {
    const res = await getTasks();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load tasks");
    return res.data;
  },
  staleTime: 30_000,
});

export const taskDetailOptions = (id: string) =>
  queryOptions<TaskDetail>({
    queryKey: qk.taskDetail(id),
    queryFn: async () => {
      const res = await getTask(id);
      if (!res.success || !res.data) throw new Error(res.error ?? "Task not found");
      return res.data;
    },
    staleTime: 30_000,
  });

export const projectsListOptions = (archived: boolean) =>
  queryOptions({
    queryKey: qk.projectsList(archived),
    queryFn: async () => {
      const res = await getProjects({ archived });
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load projects");
      return res.data;
    },
    staleTime: 120_000,
  });

export const projectDetailOptions = (id: string) =>
  queryOptions<ProjectDetail>({
    queryKey: qk.projectDetail(id),
    queryFn: async () => {
      const res = await getProject(id);
      if (!res.success || !res.data) throw new Error(res.error ?? "Project not found");
      return res.data;
    },
    staleTime: 120_000,
  });

export const clientsListOptions = (archived: boolean) =>
  queryOptions({
    queryKey: qk.clientsList(archived),
    queryFn: async () => {
      const res = await getClients({ archived });
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load clients");
      return res.data;
    },
    staleTime: 120_000,
  });

export const clientDetailOptions = (id: string) =>
  queryOptions<ClientDetail>({
    queryKey: qk.clientDetail(id),
    queryFn: async () => {
      const res = await getClient(id);
      if (!res.success || !res.data) throw new Error(res.error ?? "Client not found");
      return res.data;
    },
    staleTime: 120_000,
  });

export const teamMembersOptions = queryOptions<TeamMember[]>({
  queryKey: qk.employeesList(),
  queryFn: async () => {
    const res = await getTeamMembers();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load team");
    return res.data;
  },
  staleTime: 120_000,
});

export const employeeDetailOptions = (id: string) =>
  queryOptions<EmployeeProfileDetail>({
    queryKey: qk.employeeDetail(id),
    queryFn: async () => {
      const res = await getEmployeeProfile(id);
      if (!res.success || !res.data) throw new Error(res.error ?? "Employee not found");
      return res.data;
    },
    staleTime: 120_000,
  });

export const activeEmployeesOptions = queryOptions<
  Array<{ id: string; full_name: string; avatar_url: string | null }>
>({
  queryKey: qk.activeEmployees(),
  queryFn: async () => {
    const res = await getActiveEmployees();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load employees");
    return res.data;
  },
  staleTime: 120_000,
});

export const notificationsOptions = queryOptions<Notification[]>({
  queryKey: qk.notifications(),
  queryFn: async () => {
    const res = await getNotifications();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load notifications");
    return res.data;
  },
  staleTime: 30_000,
});

export const adminDashboardOptions = queryOptions<AdminDashboardData>({
  queryKey: qk.dashboard("admin"),
  queryFn: async () => {
    const res = await getAdminDashboard();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load dashboard");
    return res.data;
  },
  staleTime: 30_000,
});

export const employeeDashboardOptions = queryOptions<EmployeeDashboardData>({
  queryKey: qk.dashboard("employee"),
  queryFn: async () => {
    const res = await getEmployeeDashboard();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load dashboard");
    return res.data;
  },
  staleTime: 30_000,
});

export const myEarningsOptions = (weekOffset: number) =>
  queryOptions<EarningsData>({
    queryKey: qk.myEarnings(weekOffset),
    queryFn: async () => {
      const res = await getMyEarnings(weekOffset);
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load your payments");
      return res.data;
    },
    staleTime: 30_000,
  });

export const paymentWorkspaceOptions = queryOptions<PaymentWorkspaceData>({
  queryKey: qk.paymentWorkspace(),
  queryFn: async () => {
    const res = await getPaymentWorkspace();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load payments");
    return res.data;
  },
  staleTime: 30_000,
});

export const payableTasksOptions = (employeeId: string) =>
  queryOptions<PayableTask[]>({
    queryKey: qk.payableTasks(employeeId),
    queryFn: async () => {
      const res = await getEmployeePayableTasks(employeeId);
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load tasks");
      return res.data;
    },
    staleTime: 30_000,
    enabled: !!employeeId,
  });

export const labelsOptions = queryOptions<Label[]>({
  queryKey: qk.labels(),
  queryFn: async () => {
    const res = await getLabels();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load labels");
    return res.data;
  },
  staleTime: 300_000,
});

export const savedFiltersOptions = queryOptions<SavedFilterRow[]>({
  queryKey: qk.savedFilters(),
  queryFn: async () => {
    const res = await getSavedFilters();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load saved views");
    return res.data;
  },
  staleTime: 300_000,
});

/**
 * Profile memo — server identity gate keyed by updated_at. Navigating to
 * /profile re-serves this from cache; edits write here + patch session.
 */
export const profileMemoOptions = (updatedAt: string) =>
  queryOptions<Profile>({
    queryKey: ["profile", "memo", updatedAt],
    queryFn: async () => {
      const res = await getMyProfile();
      if (!res.success || !res.data) throw new Error(res.error ?? "Profile not found");
      return res.data as Profile;
    },
    staleTime: 300_000,
    enabled: false, // only served from cache or explicit fetch
  });

/** ACTIVE projects + client names for task create/edit dropdowns. */
export const projectsForTaskOptions = queryOptions<
  Array<{ id: string; name: string; client_name: string }>
>({
  queryKey: qk.projectsForTask(),
  queryFn: async () => {
    const res = await getProjectsForTask();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load projects");
    return res.data;
  },
  staleTime: 120_000,
});

/** ACTIVE clients for the project create/edit dropdown. */
export const activeClientsOptions = queryOptions({
  queryKey: qk.activeClients(),
  queryFn: async () => {
    const res = await getActiveClients();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load clients");
    return res.data;
  },
  staleTime: 120_000,
});

/** Agency settings rows (key/value) — read-through cache for the settings form. */
export const settingsOptions = queryOptions<Record<string, unknown>>({
  queryKey: qk.settings(),
  queryFn: async () => {
    const { createClient } = await import("@/lib/supabase/client");
    const { data, error } = await createClient().from("settings").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).reduce(
      (acc: Record<string, unknown>, row: { key: string; value: unknown }) => {
        acc[row.key] = row.value;
        return acc;
      },
      {}
    );
  },
  staleTime: 300_000,
});

export const taskActivityOptions = (taskId: string, limit: number) =>
  queryOptions<ActivityItem[]>({
    queryKey: qk.taskActivity(taskId, limit),
    queryFn: async () => {
      const res = await getTaskActivity(taskId, limit);
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load activity");
      return res.data;
    },
    staleTime: 30_000,
  });

export const projectActivityOptions = (projectId: string, limit: number) =>
  queryOptions<ActivityItem[]>({
    queryKey: qk.projectActivity(projectId, limit),
    queryFn: async () => {
      const res = await getProjectActivity(projectId, limit);
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load activity");
      return res.data;
    },
    staleTime: 30_000,
  });
