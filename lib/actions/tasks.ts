"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth, hasProjectAccess } from "@/lib/auth";
import { taskSchema, type TaskInput } from "@/validators/schemas";
import type {
  ActionResponse,
  Task,
  TaskWithRelations,
  Notification,
} from "@/types/database";

export async function getTasks(filters?: {
  status?: string;
  priority?: string;
  assigned_to?: string;
  project_id?: string;
  client_id?: string;
  payment_status?: string;
}): Promise<ActionResponse<TaskWithRelations[]>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    let query = supabase
      .from("tasks")
      .select("*, project:projects(*, client:clients(*)), assigned_user:profiles!tasks_assigned_to_fkey(full_name, avatar_url)")
      .order("created_at", { ascending: false });

    // Employees only see their own tasks
    if (profile.role === "EMPLOYEE") {
      query = query.eq("assigned_to", profile.id);
    }

    // Apply filters
    if (filters?.status) {
      query = query.eq("status", filters.status);
    }
    if (filters?.priority) {
      query = query.eq("priority", filters.priority);
    }
    if (filters?.assigned_to) {
      query = query.eq("assigned_to", filters.assigned_to);
    }
    if (filters?.project_id) {
      query = query.eq("project_id", filters.project_id);
    }
    if (filters?.payment_status) {
      query = query.eq("payment_status", filters.payment_status);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: "Failed to load tasks" };
    }

    let tasks = data as TaskWithRelations[];

    // Filter by client_id (since it's nested)
    if (filters?.client_id) {
      tasks = tasks.filter(
        (t) => (t.project as unknown as { client_id?: string })?.client_id === filters.client_id
      );
    }

    return { success: true, data: tasks };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function getTask(
  id: string
): Promise<ActionResponse<TaskWithRelations>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("tasks")
      .select("*, project:projects(*, client:clients(*)), assigned_user:profiles!tasks_assigned_to_fkey(*)")
      .eq("id", id)
      .single();

    if (error) {
      return { success: false, error: "Task not found" };
    }

    // Check access
    if (profile.role === "EMPLOYEE") {
      if (data.assigned_to !== profile.id) {
        const hasAccess = await hasProjectAccess(
          data.project_id,
          profile.id,
          profile.role
        );
        if (!hasAccess) {
          return { success: false, error: "Access denied" };
        }
      }
    }

    // Fetch comments
    const { data: comments } = await supabase
      .from("task_comments")
      .select("*, user:profiles(id, full_name, avatar_url)")
      .eq("task_id", id)
      .order("created_at");

    // Fetch attachments
    const { data: attachments } = await supabase
      .from("task_attachments")
      .select("*")
      .eq("task_id", id)
      .order("created_at");

    const task = {
      ...data,
      comments: comments || [],
      attachments: attachments || [],
    } as TaskWithRelations & {
      comments: Array<{ id: string; comment: string; created_at: string; user: { id: string; full_name: string; avatar_url: string | null } }>;
      attachments: Array<{ id: string; file_name: string; file_path: string; mime_type: string | null; created_at: string }>;
    };

    return { success: true, data: task };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function createTaskAction(
  input: TaskInput
): Promise<ActionResponse<Task>> {
  try {
    const profile = await requireAdmin();

    const validated = taskSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: validated.data.project_id,
        assigned_to: validated.data.assigned_to || null,
        title: validated.data.title,
        description: validated.data.description || null,
        status: validated.data.status || "TODO",
        priority: validated.data.priority || "MEDIUM",
        deadline: validated.data.deadline || null,
        payout_amount: validated.data.payout_amount || 0,
        payment_status: validated.data.payment_status || "NOT_APPLICABLE",
        created_by: profile.id,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: "Failed to create task" };
    }

    // Create notification if assigned
    if (validated.data.assigned_to) {
      await supabase.from("notifications").insert({
        user_id: validated.data.assigned_to,
        type: "TASK_ASSIGNED",
        title: "New task assigned",
        message: `You've been assigned: ${validated.data.title}`,
        reference_type: "task",
        reference_id: data.id,
      });
    }

    return { success: true, data: data as Task };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function updateTaskAction(
  id: string,
  input: TaskInput
): Promise<ActionResponse<Task>> {
  try {
    await requireAdmin();

    const validated = taskSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .update({
        project_id: validated.data.project_id,
        assigned_to: validated.data.assigned_to || null,
        title: validated.data.title,
        description: validated.data.description || null,
        status: validated.data.status || "TODO",
        priority: validated.data.priority || "MEDIUM",
        deadline: validated.data.deadline || null,
        payout_amount: validated.data.payout_amount || 0,
        payment_status: validated.data.payment_status || "NOT_APPLICABLE",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return { success: false, error: "Failed to update task" };
    }

    return { success: true, data: data as Task };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteTaskAction(
  id: string
): Promise<ActionResponse> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { error } = await supabase.from("tasks").delete().eq("id", id);

    if (error) {
      return { success: false, error: "Failed to delete task" };
    }

    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function updateTaskStatus(
  taskId: string,
  status: Task["status"],
  comment?: string
): Promise<ActionResponse<Task>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    // Get current task
    const { data: currentTask } = await supabase
      .from("tasks")
      .select("*, project:projects(*)")
      .eq("id", taskId)
      .single();

    if (!currentTask) {
      return { success: false, error: "Task not found" };
    }

    // Employees can only submit (IN_PROGRESS → SUBMITTED)
    if (profile.role === "EMPLOYEE") {
      if (status !== "SUBMITTED" || currentTask.assigned_to !== profile.id) {
        return { success: false, error: "Unauthorized status change" };
      }
    }

    const updateData: Record<string, unknown> = { status };

    // Set completed_at when marking as completed
    if (status === "COMPLETED") {
      updateData.completed_at = new Date().toISOString();
      updateData.payment_status = "PENDING";
    }

    const { data, error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", taskId)
      .select()
      .single();

    if (error) {
      return { success: false, error: "Failed to update task status" };
    }

    // Create notifications based on status change
    const notifications: Array<{
      user_id: string;
      type: Notification["type"];
      title: string;
      message: string;
      reference_type: string;
      reference_id: string;
    }> = [];

    if (status === "SUBMITTED" && currentTask.assigned_to) {
      // Notify admin
      const { data: admins } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "ADMIN");

      admins?.forEach((admin) => {
        notifications.push({
          user_id: admin.id,
          type: "TASK_SUBMITTED",
          title: "Task submitted",
          message: `Task "${currentTask.title}" submitted for review`,
          reference_type: "task",
          reference_id: taskId,
        });
      });
    } else if (
      (status === "APPROVED" || status === "REVISION_REQUIRED") &&
      currentTask.assigned_to
    ) {
      notifications.push({
        user_id: currentTask.assigned_to,
        type: status === "APPROVED" ? "TASK_APPROVED" : "REVISION_REQUESTED",
        title: status === "APPROVED" ? "Task approved" : "Revision requested",
        message:
          status === "APPROVED"
            ? `Your task "${currentTask.title}" has been approved!`
            : `Your task "${currentTask.title}" needs revision.${comment ? ` Note: ${comment}` : ""}`,
        reference_type: "task",
        reference_id: taskId,
      });
    }

    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }

    // Add comment if provided
    if (comment) {
      await supabase.from("task_comments").insert({
        task_id: taskId,
        user_id: profile.id,
        comment,
      });
    }

    return { success: true, data: data as Task };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Get projects for task form dropdown.
 */
export async function getProjectsForTask(): Promise<
  ActionResponse<Array<{ id: string; name: string; client_name: string }>>
> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    let query = supabase
      .from("projects")
      .select("id, name, client:clients(name)")
      .order("name");

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
      return { success: false, error: "Failed to load projects" };
    }

    const projects = (data || []).map(
      (p: { id: string; name: string; client: { name: string }[] | null }) => ({
        id: p.id,
        name: p.name,
        client_name: p.client?.[0]?.name || "",
      })
    );

    return { success: true, data: projects };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
