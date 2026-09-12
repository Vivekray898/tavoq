"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth, hasProjectAccess } from "@/lib/auth";
import { projectSchema, type ProjectInput } from "@/validators/schemas";
import type {
  ActionResponse,
  Project,
  ProjectWithRelations,
  ProjectMember,
  ProjectResource,
} from "@/types/database";

export async function getProjects(): Promise<ActionResponse<ProjectWithRelations[]>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    let query = supabase
      .from("projects")
      .select("*, client:clients(*)")
      .order("created_at", { ascending: false });

    // Employees only see projects they're members of
    if (profile.role === "EMPLOYEE") {
      const { data: memberProjects } = await supabase
        .from("project_members")
        .select("project_id")
        .eq("user_id", profile.id);

      const projectIds = memberProjects?.map((m) => m.project_id) || [];
      if (projectIds.length === 0) {
        return { success: true, data: [] };
      }
      query = query.in("id", projectIds);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: "Failed to load projects" };
    }

    return { success: true, data: data as ProjectWithRelations[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function getProject(
  id: string
): Promise<ActionResponse<ProjectWithRelations>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    // Check access
    if (profile.role !== "ADMIN") {
      const hasAccess = await hasProjectAccess(id, profile.id, profile.role);
      if (!hasAccess) {
        return { success: false, error: "Access denied" };
      }
    }

    const { data, error } = await supabase
      .from("projects")
      .select("*, client:clients(*)")
      .eq("id", id)
      .single();

    if (error) {
      return { success: false, error: "Project not found" };
    }

    // Fetch members
    const { data: members } = await supabase
      .from("project_members")
      .select("*, user:profiles(*)")
      .eq("project_id", id);

    // Fetch resources
    const { data: resources } = await supabase
      .from("project_resources")
      .select("*")
      .eq("project_id", id)
      .order("created_at");

    // Fetch tasks count
    const { count: tasksCount } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("project_id", id);

    const project = {
      ...data,
      members: members || [],
      resources: resources || [],
      tasks_count: tasksCount || 0,
    } as ProjectWithRelations;

    return { success: true, data: project };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function createProjectAction(
  input: ProjectInput
): Promise<ActionResponse<Project>> {
  try {
    const profile = await requireAdmin();

    const validated = projectSchema.safeParse(input);
    if (!validated.success) {
      console.error("[createProjectAction] Zod validation failed:", validated.error.flatten());
      return { success: false, error: "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        client_id: validated.data.client_id,
        name: validated.data.name,
        description: validated.data.description || null,
        status: validated.data.status,
        start_date: validated.data.start_date || null,
        end_date: validated.data.end_date || null,
        created_by: profile.id,
      })
      .select()
      .single();

    if (error) {
      // 👇 Log the real error so you can see it in the terminal
      console.error("[createProjectAction] Supabase insert error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        input: validated.data,
        userId: profile.id,
      });
      return { success: false, error: `Failed to create project: ${error.message}` };
    }

    return { success: true, data: data as Project };
  } catch (err) {
    console.error("[createProjectAction] Unexpected error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unauthorized" };
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
      return { success: false, error: "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update({
        client_id: validated.data.client_id,
        name: validated.data.name,
        description: validated.data.description || null,
        status: validated.data.status,
        start_date: validated.data.start_date || null,
        end_date: validated.data.end_date || null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return { success: false, error: "Failed to update project" };
    }

    return { success: true, data: data as Project };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteProjectAction(
  id: string
): Promise<ActionResponse> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { error } = await supabase.from("projects").delete().eq("id", id);

    if (error) {
      return { success: false, error: "Failed to delete project" };
    }

    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ─── Project Members ───

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: "MEMBER" | "LEAD" = "MEMBER"
): Promise<ActionResponse<ProjectMember>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_members")
      .insert({ project_id: projectId, user_id: userId, role })
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

// ─── Project Resources ───

export async function addProjectResource(
  projectId: string,
  resource: {
    title: string;
    url: string;
    description?: string;
    resource_type: string;
  }
): Promise<ActionResponse<ProjectResource>> {
  try {
    const profile = await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_resources")
      .insert({
        project_id: projectId,
        title: resource.title,
        url: resource.url,
        description: resource.description || null,
        resource_type: resource.resource_type,
        created_by: profile.id,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: "Failed to add resource" };
    }

    return { success: true, data: data as ProjectResource };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteProjectResource(
  resourceId: string
): Promise<ActionResponse> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { error } = await supabase
      .from("project_resources")
      .delete()
      .eq("id", resourceId);

    if (error) {
      return { success: false, error: "Failed to delete resource" };
    }

    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}