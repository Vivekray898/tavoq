"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth, hasProjectAccess } from "@/lib/auth";
import { projectSchema, projectResourceSchema, type ProjectInput, type ProjectResourceInput } from "@/validators/schemas";
import type {
  ActionResponse,
  Project,
  ProjectWithRelations,
  ProjectMember,
  ProjectResource,
} from "@/types/database";

export async function getProjects(
  options?: { archived?: boolean }
): Promise<
  ActionResponse<
    Array<
      Project & {
        client_name: string | null;
        active_tasks: number;
      }
    >
  >
> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    // §41 — Active and Archived are separate views, never mixed.
    let query = supabase
      .from("projects")
      .select("*, client:clients(name)")
      .order("created_at", { ascending: false });

    if (options?.archived) {
      query = query.eq("status", "ARCHIVED");
    } else {
      query = query.neq("status", "ARCHIVED");
    }

    if (profile.role === "EMPLOYEE") {
      const { data: memberProjects } = await supabase
        .from("project_members")
        .select("project_id")
        .eq("user_id", profile.id);

      const projectIds = memberProjects?.map((m) => m.project_id) || [];
      if (projectIds.length === 0) return { success: true, data: [] };
      query = query.in("id", projectIds);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getProjects]", error);
      return { success: false, error: "Failed to load projects" };
    }

    // Active task counts per project
    const projectIds = (data ?? []).map((p: { id: string }) => p.id);
    const counts = new Map<string, number>();
    if (projectIds.length > 0) {
      const { data: tasks } = await supabase
        .from("tasks")
        .select("project_id")
        .in("project_id", projectIds)
        .not("status", "in", '("COMPLETED")');
      (tasks ?? []).forEach((t: { project_id: string }) => {
        counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
      });
    }

    const projects = (data ?? []).map(
      (p: { client: { name: string }[] | null } & Project) => ({
        ...p,
        client_name: p.client?.[0]?.name ?? null,
        active_tasks: counts.get(p.id) ?? 0,
      })
    );

    return { success: true, data: projects };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export interface ProjectDetail
  extends Omit<ProjectWithRelations, "tasks" | "members" | "resources"> {
  client_name: string | null;
  members: ProjectMember[];
  resources: ProjectResource[];
  task_counts: {
    total: number;
    completed: number;
    in_progress: number;
    submitted: number;
    overdue: number;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    deadline: string | null;
    payout_amount: number;
    payment_status: string;
    assigned_name: string | null;
  }>;
}

export async function getProject(id: string): Promise<ActionResponse<ProjectDetail>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    if (profile.role !== "ADMIN") {
      const hasAccess = await hasProjectAccess(id, profile.id, profile.role);
      if (!hasAccess) {
        return { success: false, error: "You don't have access to this project" };
      }
    }

    const { data, error } = await supabase
      .from("projects")
      .select("*, client:clients(id, name)")
      .eq("id", id)
      .single();

    if (error || !data) {
      return { success: false, error: "Project not found" };
    }

    const [membersRes, resourcesRes, tasksRes] = await Promise.all([
      supabase
        .from("project_members")
        .select("*, user:profiles(id, full_name, avatar_url, email)")
        .eq("project_id", id),
      supabase
        .from("project_resources")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("tasks")
        .select(
          "id, title, status, priority, deadline, payout_amount, payment_status, assigned_user:profiles!tasks_assigned_to_fkey(full_name)"
        )
        .eq("project_id", id)
        .order("deadline", { ascending: true, nullsFirst: false }),
    ]);

    const tasks = (tasksRes.data ?? []).map(
      (t: {
        id: string;
        title: string;
        status: string;
        priority: string;
        deadline: string | null;
        payout_amount: number;
        payment_status: string;
        assigned_user: { full_name: string }[] | { full_name: string } | null;
      }) => {
        const u = Array.isArray(t.assigned_user)
          ? t.assigned_user[0]
          : t.assigned_user;
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          deadline: t.deadline,
          payout_amount: Number(t.payout_amount),
          payment_status: t.payment_status,
          assigned_name: u?.full_name ?? null,
        };
      }
    );

    const task_counts = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "COMPLETED").length,
      in_progress: tasks.filter(
        (t) => t.status === "IN_PROGRESS" || t.status === "TODO" || t.status === "REVISION_REQUIRED"
      ).length,
      submitted: tasks.filter((t) => t.status === "SUBMITTED").length,
      overdue: tasks.filter(
        (t) =>
          t.status !== "COMPLETED" &&
          t.deadline &&
          new Date(t.deadline).getTime() < Date.now()
      ).length,
    };

    const client = data.client as unknown as { id: string; name: string }[] | null;

    const project = {
      ...(data as unknown as Project),
      client_name: client?.[0]?.name ?? null,
      members: (membersRes.data ?? []) as ProjectMember[],
      resources: (resourcesRes.data ?? []) as ProjectResource[],
      tasks,
      task_counts,
    };

    return { success: true, data: project };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function createProjectAction(
  input: ProjectInput & { member_ids?: string[] }
): Promise<ActionResponse<Project>> {
  try {
    const profile = await requireAdmin();

    const validated = projectSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        client_id: validated.data.client_id,
        name: validated.data.name,
        description: validated.data.description || null,
        status: validated.data.status || "ACTIVE",
        start_date: validated.data.start_date || null,
        end_date: validated.data.end_date || null,
        created_by: profile.id,
      })
      .select()
      .single();

    if (error) {
      console.error("[createProjectAction]", error);
      return { success: false, error: "Failed to create project" };
    }

    const project = data as Project;

    // Add team members
    const memberIds = (input.member_ids ?? []).filter(Boolean);
    if (memberIds.length > 0) {
      await supabase.from("project_members").insert(
        memberIds.map((userId) => ({
          project_id: project.id,
          user_id: userId,
          role: "MEMBER" as const,
        }))
      );
    }

    return { success: true, data: project };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function updateProjectAction(
  id: string,
  input: ProjectInput
): Promise<ActionResponse<Project>> {
  try {
    await requireAdmin();

    const validated = projectSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update({
        client_id: validated.data.client_id,
        name: validated.data.name,
        description: validated.data.description || null,
        status: validated.data.status || "ACTIVE",
        start_date: validated.data.start_date || null,
        end_date: validated.data.end_date || null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[updateProjectAction]", error);
      return { success: false, error: "Failed to update project" };
    }

    return { success: true, data };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Archive instead of delete (§56) */
export async function archiveProjectAction(id: string): Promise<ActionResponse> {
  try {
    const profile = await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({ status: "ARCHIVED" })
      .eq("id", id);
    if (error) {
      console.error("[archiveProjectAction]", error);
      return { success: false, error: "Failed to archive project" };
    }
    const { error: auditError } = await supabase.from("admin_audit_log").insert({
      actor_id: profile.id,
      action: "PROJECT_ARCHIVED",
      detail: id,
    });
    if (auditError) return { success: false, error: "Project archived, but audit logging failed" };
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** §47 — restore brings the project back to ACTIVE */
export async function restoreProjectAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({ status: "ACTIVE" })
      .eq("id", id);
    if (error) {
      console.error("[restoreProjectAction]", error);
      return { success: false, error: "Failed to restore project" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Permanent delete (§46) — only allowed when nothing references the
 * project, so agency history is never silently destroyed.
 */
export async function deleteProjectAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin();
    const supabase = await createClient();

    const { count: taskCount } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id);

    if ((taskCount ?? 0) > 0) {
      return {
        success: false,
        error: `This project still has ${taskCount} task${taskCount === 1 ? "" : "s"}. Delete those first, or keep the project archived.`,
      };
    }

    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      console.error("[deleteProjectAction]", error);
      return {
        success: false,
        error: "Couldn't delete the project. It may have related records that need to be handled first.",
      };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function addProjectMember(
  projectId: string,
  userId: string
): Promise<ActionResponse<ProjectMember>> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_members")
      .insert({ project_id: projectId, user_id: userId, role: "MEMBER" })
      .select()
      .single();
    if (error) {
      return { success: false, error: "Failed to add member" };
    }
    return { success: true, data: data as ProjectMember };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<ActionResponse> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId);
    if (error) {
      return { success: false, error: "Failed to remove member" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Resources
// ──────────────────────────────────────────────

export async function addProjectResource(
  projectId: string,
  resource: ProjectResourceInput
): Promise<ActionResponse<ProjectResource>> {
  try {
    const profile = await requireAdmin();

    const validated = projectResourceSchema.safeParse(resource);
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid resource" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_resources")
      .insert({
        project_id: projectId,
        title: validated.data.title,
        url: validated.data.url,
        description: validated.data.description || null,
        resource_type: validated.data.resource_type || "OTHER",
        created_by: profile.id,
      })
      .select()
      .single();

    if (error) {
      console.error("[addProjectResource]", error);
      return { success: false, error: "Failed to add resource" };
    }

    return { success: true, data: data as ProjectResource };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteProjectResource(resourceId: string): Promise<ActionResponse> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_resources")
      .delete()
      .eq("id", resourceId);
    if (error) {
      return { success: false, error: "Failed to remove resource" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
