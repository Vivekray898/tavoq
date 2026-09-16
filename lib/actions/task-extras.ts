"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireAdmin } from "@/lib/auth";
import { labelSchema, subtaskSchema, type LabelInput, type SubtaskInput } from "@/validators/schemas";
import type { ActionResponse, Label, TaskSubtask } from "@/types/database";

// ──────────────────────────────────────────────
// Labels (§19)
// ──────────────────────────────────────────────

export async function getLabels(): Promise<ActionResponse<Label[]>> {
  try {
    await requireAuth();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("labels")
      .select("*")
      .order("name");

    if (error) {
      console.error("[getLabels]", error);
      return { success: false, error: "Failed to load labels" };
    }
    return { success: true, data: (data ?? []) as Label[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function createLabelAction(input: LabelInput): Promise<ActionResponse<Label>> {
  try {
    await requireAdmin();
    const validated = labelSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid label" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("labels")
      .insert({ name: validated.data.name, color: validated.data.color ?? "GRAY" })
      .select()
      .single();

    if (error) {
      const duplicate = error.code === "23505";
      console.error("[createLabelAction]", error);
      return {
        success: false,
        error: duplicate ? "A label with this name already exists" : "Failed to create label",
      };
    }
    return { success: true, data: data as Label };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteLabelAction(labelId: string): Promise<ActionResponse> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase.from("labels").delete().eq("id", labelId);
    if (error) {
      return { success: false, error: "Failed to delete label" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function setTaskLabels(
  taskId: string,
  labelIds: string[]
): Promise<ActionResponse> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    // Verify access to the task
    const { data: task } = await supabase
      .from("tasks")
      .select("id, assigned_to, project_id")
      .eq("id", taskId)
      .single();
    if (!task) return { success: false, error: "Task not found" };

    if (profile.role === "EMPLOYEE" && task.assigned_to !== profile.id) {
      const { data: member } = await supabase
        .from("project_members")
        .select("id")
        .eq("project_id", task.project_id)
        .eq("user_id", profile.id)
        .maybeSingle();
      if (!member) {
        return { success: false, error: "You don't have access to this task" };
      }
    }

    // Replace the label set
    const { error: delError } = await supabase
      .from("task_labels")
      .delete()
      .eq("task_id", taskId);
    if (delError) {
      console.error("[setTaskLabels] delete", delError);
      return { success: false, error: "Failed to update labels" };
    }

    if (labelIds.length > 0) {
      const { error: insError } = await supabase.from("task_labels").insert(
        labelIds.map((labelId) => ({ task_id: taskId, label_id: labelId }))
      );
      if (insError) {
        console.error("[setTaskLabels] insert", insError);
        return { success: false, error: "Failed to update labels" };
      }
    }

    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Subtasks / checklists (§21)
// ──────────────────────────────────────────────

export type SubtaskWithMeta = TaskSubtask;

export async function getSubtasks(taskId: string): Promise<ActionResponse<TaskSubtask[]>> {
  try {
    await requireAuth();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("task_subtasks")
      .select("*")
      .eq("task_id", taskId)
      .order("position", { ascending: true });

    if (error) {
      console.error("[getSubtasks]", error);
      return { success: false, error: "Failed to load checklist" };
    }
    return { success: true, data: (data ?? []) as TaskSubtask[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

async function canAccessTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const { data: task } = await supabase
    .from("tasks")
    .select("id, assigned_to, project_id")
    .eq("id", taskId)
    .single();
  if (!task) return false;
  if (task.assigned_to === userId) return true;
  const { data: member } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", task.project_id)
    .eq("user_id", userId)
    .maybeSingle();
  return !!member;
}

export async function addSubtask(
  taskId: string,
  input: SubtaskInput
): Promise<ActionResponse<TaskSubtask>> {
  try {
    const profile = await requireAuth();
    const validated = subtaskSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid subtask" };
    }

    const supabase = await createClient();
    if (!(await canAccessTask(supabase, taskId, profile.id, profile.role === "ADMIN"))) {
      return { success: false, error: "You don't have access to this task" };
    }

    // Position at the end
    const { count } = await supabase
      .from("task_subtasks")
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId);

    const { data, error } = await supabase
      .from("task_subtasks")
      .insert({
        task_id: taskId,
        title: validated.data.title,
        position: count ?? 0,
      })
      .select()
      .single();

    if (error) {
      console.error("[addSubtask]", error);
      return { success: false, error: "Failed to add checklist item" };
    }
    return { success: true, data: data as TaskSubtask };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function toggleSubtask(
  subtaskId: string,
  done: boolean
): Promise<ActionResponse> {
  try {
    await requireAuth();
    const supabase = await createClient();
    const { error } = await supabase
      .from("task_subtasks")
      .update({ done })
      .eq("id", subtaskId);

    if (error) {
      console.error("[toggleSubtask]", error);
      return { success: false, error: "Failed to update checklist" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteSubtask(subtaskId: string): Promise<ActionResponse> {
  try {
    await requireAuth();
    const supabase = await createClient();
    const { error } = await supabase
      .from("task_subtasks")
      .delete()
      .eq("id", subtaskId);

    if (error) {
      console.error("[deleteSubtask]", error);
      return { success: false, error: "Failed to remove checklist item" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Saved filters (§25)
// ──────────────────────────────────────────────

export interface SavedFilterRow {
  id: string;
  name: string;
  filters: Record<string, string>;
}

export async function getSavedFilters(): Promise<ActionResponse<SavedFilterRow[]>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("saved_filters")
      .select("id, name, filters")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[getSavedFilters]", error);
      return { success: false, error: "Failed to load saved views" };
    }
    return {
      success: true,
      data: (data ?? []).map((row: { id: string; name: string; filters: unknown }) => ({
        id: row.id,
        name: row.name,
        filters: (row.filters ?? {}) as Record<string, string>,
      })),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function saveFilter(
  name: string,
  filters: Record<string, string>
): Promise<ActionResponse<SavedFilterRow>> {
  try {
    const profile = await requireAuth();
    if (!name.trim()) return { success: false, error: "Name is required" };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("saved_filters")
      .insert({ user_id: profile.id, name: name.trim(), filters })
      .select("id, name, filters")
      .single();

    if (error) {
      console.error("[saveFilter]", error);
      return { success: false, error: "Failed to save view" };
    }
    return {
      success: true,
      data: {
        id: data.id,
        name: data.name,
        filters: (data.filters ?? {}) as Record<string, string>,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteSavedFilter(id: string): Promise<ActionResponse> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();
    const { error } = await supabase
      .from("saved_filters")
      .delete()
      .eq("id", id)
      .eq("user_id", profile.id);

    if (error) {
      return { success: false, error: "Failed to delete view" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
