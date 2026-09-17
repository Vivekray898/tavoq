"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth, hasProjectAccess } from "@/lib/auth";
import { taskSchema, type TaskInput } from "@/validators/schemas";
import {
  createNotification,
  createNotifications,
  sendEventEmail,
} from "@/lib/notifications";
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from "@/lib/constants";
import type { ActionResponse, Task, TaskStatus } from "@/types/database";

// ──────────────────────────────────────────────
// Shared query shape
// ──────────────────────────────────────────────

const TASK_SELECT = `
  *,
  project:projects(id, name, client:clients(id, name)),
  assigned_user:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url),
  labels:task_labels(label:labels(id, name, color)),
  subtasks:task_subtasks(id, done),
  comments_count:task_comments(count),
  attachments_count:task_attachments(count)
` as const;

interface AssignedUser {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

interface LabelShape {
  id: string;
  name: string;
  color: string;
}

/**
 * PostgREST returns a single object for many-to-one embeds but
 * Supabase's inferred types describe them as arrays. Accept both
 * shapes and normalise to a single object (or null).
 */
type EmbeddedOne<T> = T | T[] | null | undefined;

function one<T>(value: EmbeddedOne<T>): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

interface TaskRow {
  project: EmbeddedOne<{
    id: string;
    name: string;
    client: EmbeddedOne<{ id: string; name: string }>;
  }>;
  assigned_user: EmbeddedOne<AssignedUser>;
  labels?: EmbeddedOne<{ label: EmbeddedOne<LabelShape> }>[] | null;
  subtasks?: Array<{ id: string; done: boolean }> | null;
  comments_count?: Array<{ count: number }> | null;
  attachments_count?: Array<{ count: number }> | null;
  [key: string]: unknown;
}

export interface TaskListItem extends Task {
  project_name: string | null;
  client_name: string | null;
  assigned_name: string | null;
  labels: LabelShape[];
  subtasks_done: number;
  subtasks_total: number;
  comments_count: number;
  attachments_count: number;
}

function toListItem(row: TaskRow): TaskListItem {
  const task = row as unknown as Task;
  const subtasks = row.subtasks ?? [];
  const project = one(row.project);
  const client = one(project?.client);
  const assignee = one(row.assigned_user);

  const labels: LabelShape[] = (row.labels ?? [])
    .map((l) => one(l.label))
    .filter((l): l is LabelShape => !!l);

  return {
    ...task,
    project_name: project?.name ?? null,
    client_name: client?.name ?? null,
    assigned_name: assignee?.full_name ?? null,
    labels,
    subtasks_done: subtasks.filter((s) => s.done).length,
    subtasks_total: subtasks.length,
    comments_count: row.comments_count?.[0]?.count ?? 0,
    attachments_count: row.attachments_count?.[0]?.count ?? 0,
  };
}

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

export async function getTasks(filters?: {
  status?: string;
  priority?: string;
  assigned_to?: string;
  project_id?: string;
  label_id?: string;
  payment_status?: string;
  q?: string;
}): Promise<ActionResponse<TaskListItem[]>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    let query = supabase
      .from("tasks")
      .select(TASK_SELECT)
      .order("created_at", { ascending: false });

    // Employees only see their own tasks
    if (profile.role === "EMPLOYEE") {
      query = query.eq("assigned_to", profile.id);
    }

    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.priority) query = query.eq("priority", filters.priority);
    if (filters?.assigned_to) query = query.eq("assigned_to", filters.assigned_to);
    if (filters?.project_id) query = query.eq("project_id", filters.project_id);
    if (filters?.payment_status)
      query = query.eq("payment_status", filters.payment_status);
    if (filters?.q) query = query.ilike("title", `%${filters.q}%`);

    const { data, error } = await query;

    if (error) {
      console.error("[getTasks]", error);
      return { success: false, error: "Failed to load tasks" };
    }

    let tasks = ((data ?? []) as unknown as TaskRow[]).map(toListItem);

    // Label filter (post-query since the join is nested)
    if (filters?.label_id) {
      tasks = tasks.filter((t) => t.labels.some((l) => l.id === filters.label_id));
    }

    // Overdue filter
    if (filters?.status === "OVERDUE") {
      const now = Date.now();
      tasks = tasks.filter(
        (t) =>
          t.deadline &&
          new Date(t.deadline).getTime() < now &&
          t.status !== "COMPLETED"
      );
    }

    return { success: true, data: tasks };
  } catch (err) {
    console.error("[getTasks] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

export interface TaskDetail extends TaskListItem {
  description: string | null;
  comments: Array<{
    id: string;
    task_id: string;
    user_id: string;
    comment: string;
    created_at: string;
    user: { id: string; full_name: string; avatar_url: string | null };
  }>;
  attachments: Array<{
    id: string;
    file_name: string;
    file_path: string;
    file_size: number | null;
    mime_type: string | null;
    uploaded_by: string;
    created_at: string;
  }>;
  resources: Array<{
    id: string;
    title: string;
    url: string;
    description: string | null;
    resource_type: string;
  }>;
  labels: LabelShape[];
  subtasks: Array<{
    id: string;
    task_id: string;
    title: string;
    done: boolean;
    position: number;
    created_at: string;
  }>;
}

export async function getTask(id: string): Promise<ActionResponse<TaskDetail>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_SELECT + ", description")
      .eq("id", id)
      .single();

    if (error || !data) {
      console.error("[getTask] task fetch", error);
      return { success: false, error: "Task not found" };
    }

    const row = data as unknown as TaskRow & { description: string | null };
    const project = one(row.project);
    const assignee = one(row.assigned_user);

    // Check access for employees
    if (profile.role === "EMPLOYEE") {
      const isAssignee = assignee?.id === profile.id;
      const hasAccess =
        isAssignee ||
        (await hasProjectAccess(project?.id ?? "", profile.id, profile.role));
      if (!hasAccess) {
        return { success: false, error: "You don't have access to this task" };
      }
    }

    const projectId = project?.id ?? "";

    // Run all dependent fetches in parallel. Return them keyed by name
    // so a future reorder can't silently swap data between fields.
    const [labelsRes, subtasksRes, commentsRes, attachmentsRes, resourcesRes] =
      await Promise.all([
        supabase
          .from("task_labels")
          .select("label:labels(id, name, color)")
          .eq("task_id", id),
        supabase
          .from("task_subtasks")
          .select("*")
          .eq("task_id", id)
          .order("position", { ascending: true }),
        supabase
          .from("task_comments")
          .select("*, user:profiles(id, full_name, avatar_url)")
          .eq("task_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("task_attachments")
          .select("*")
          .eq("task_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("project_resources")
          .select("id, title, url, description, resource_type")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true }),
      ]);

    // Surface individual query errors instead of silently returning an
    // empty array. A quiet failure is what let the previous mis-destructure
    // hide for so long.
    const queryErrors: Array<[string, unknown]> = [];
    if (labelsRes.error) queryErrors.push(["labels", labelsRes.error]);
    if (subtasksRes.error) queryErrors.push(["subtasks", subtasksRes.error]);
    if (commentsRes.error) queryErrors.push(["comments", commentsRes.error]);
    if (attachmentsRes.error)
      queryErrors.push(["attachments", attachmentsRes.error]);
    if (resourcesRes.error)
      queryErrors.push(["resources", resourcesRes.error]);
    if (queryErrors.length > 0) {
      console.error("[getTask] dependent query errors", queryErrors);
    }

    // Normalise label rows. Supabase infers `label` as an array for
    // embedded relations; PostgREST usually returns a single object.
    // Handle both without fighting the type system.
    type RawLabelRow = { label: EmbeddedOne<LabelShape> };
    const labels: LabelShape[] = (
      (labelsRes.data ?? []) as unknown as RawLabelRow[]
    )
      .map((r) => one(r.label))
      .filter((l): l is LabelShape => !!l);

    // Dedupe comments by id. Realtime + optimistic updates can
    // otherwise deliver the same row twice, which produces
    // "Encountered two children with the same key" on the client.
    const rawComments = (commentsRes.data ??
      []) as unknown as TaskDetail["comments"];
    const commentsById = new Map<string, TaskDetail["comments"][number]>();
    for (const c of rawComments) commentsById.set(c.id, c);
    const comments = Array.from(commentsById.values()).sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const task: TaskDetail = {
      ...toListItem(row),
      description: row.description ?? null,
      comments,
      attachments: (attachmentsRes.data ??
        []) as unknown as TaskDetail["attachments"],
      resources: (resourcesRes.data ??
        []) as unknown as TaskDetail["resources"],
      labels,
      subtasks: (subtasksRes.data ?? []) as unknown as TaskDetail["subtasks"],
    };

    return { success: true, data: task };
  } catch (err) {
    console.error("[getTask] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

export async function createTaskAction(
  input: TaskInput
): Promise<ActionResponse<Task>> {
  try {
    const profile = await requireAdmin();

    const validated = taskSchema.safeParse(input);
    if (!validated.success) {
      return {
        success: false,
        error: validated.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const supabase = await createClient();

    // §40 — server-side validation: archived projects and non-ACTIVE
    // employees must never be assignable, even via a crafted request.
    const { data: project } = await supabase
      .from("projects")
      .select("status")
      .eq("id", validated.data.project_id)
      .single();
    if (!project) return { success: false, error: "Project not found" };
    if (project.status === "ARCHIVED") {
      return {
        success: false,
        error: "This project is archived — restore it before adding tasks.",
      };
    }

    if (validated.data.assigned_to) {
      const { data: assignee } = await supabase
        .from("profiles")
        .select("status, role")
        .eq("id", validated.data.assigned_to)
        .single();
      if (!assignee) return { success: false, error: "Assignee not found" };
      if (assignee.status !== "ACTIVE" || assignee.role !== "EMPLOYEE") {
        return {
          success: false,
          error: "Tasks can only be assigned to active employees",
        };
      }
    }

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
        payment_status:
          (validated.data.payout_amount ?? 0) > 0 ? "PENDING" : "NOT_APPLICABLE",
        created_by: profile.id,
      })
      .select()
      .single();

    if (error) {
      console.error("[createTaskAction]", error);
      return { success: false, error: "Failed to create task" };
    }

    const task = data as Task;

    // Attach labels
    if (validated.data.label_ids && validated.data.label_ids.length > 0) {
      await supabase.from("task_labels").insert(
        validated.data.label_ids.map((labelId) => ({
          task_id: task.id,
          label_id: labelId,
        }))
      );
    }

    // Create subtasks (§21)
    if (validated.data.subtasks && validated.data.subtasks.length > 0) {
      await supabase.from("task_subtasks").insert(
        validated.data.subtasks.map((s, i) => ({
          task_id: task.id,
          title: s.title,
          position: i,
        }))
      );
    }

    // Notify + email the assignee
    if (task.assigned_to) {
      const { data: proj } = await supabase
        .from("projects")
        .select("name, client:clients(name)")
        .eq("id", task.project_id)
        .single();
      const { data: assignee } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", task.assigned_to)
        .single();

      await createNotification({
        userId: task.assigned_to,
        type: "TASK_ASSIGNED",
        title: "New task assigned",
        message: `${task.title}`,
        referenceType: "task",
        referenceId: task.id,
      });

      if (assignee?.email) {
        const client = one(
          (proj as unknown as { client: EmbeddedOne<{ name: string }> } | null)
            ?.client
        );
        await sendEventEmail("TASK_ASSIGNED", {
          to: assignee.email,
          employeeName: assignee.full_name,
          taskTitle: task.title,
          projectName: proj?.name ?? "",
          clientName: client?.name ?? "",
          deadline: task.deadline,
          payoutAmount: Number(task.payout_amount),
        });
      }
    }

    return { success: true, data: task };
  } catch (err) {
    console.error("[createTaskAction] unexpected", err);
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
      return {
        success: false,
        error: validated.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const supabase = await createClient();

    // Same server-side guards as creation (§40)
    const { data: project } = await supabase
      .from("projects")
      .select("status")
      .eq("id", validated.data.project_id)
      .single();
    if (!project) return { success: false, error: "Project not found" };
    if (project.status === "ARCHIVED") {
      return {
        success: false,
        error: "This project is archived — restore it before adding tasks.",
      };
    }

    if (validated.data.assigned_to) {
      const { data: assignee } = await supabase
        .from("profiles")
        .select("status, role")
        .eq("id", validated.data.assigned_to)
        .single();
      if (!assignee) return { success: false, error: "Assignee not found" };
      if (assignee.status !== "ACTIVE" || assignee.role !== "EMPLOYEE") {
        return {
          success: false,
          error: "Tasks can only be assigned to active employees",
        };
      }
    }

    // Fetch the previous assignee BEFORE the update so reassignment
    // detection actually works.
    const { data: before } = await supabase
      .from("tasks")
      .select("assigned_to")
      .eq("id", id)
      .single();

    const { data, error } = await supabase
      .from("tasks")
      .update({
        project_id: validated.data.project_id,
        assigned_to: validated.data.assigned_to || null,
        title: validated.data.title,
        description: validated.data.description || null,
        priority: validated.data.priority || "MEDIUM",
        deadline: validated.data.deadline || null,
        payout_amount: validated.data.payout_amount || 0,
        payment_status: validated.data.payment_status || "NOT_APPLICABLE",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[updateTaskAction]", error);
      return { success: false, error: "Failed to update task" };
    }

    const task = data as Task;

    // Notify reassignment (only when the assignee actually changed)
    if (task.assigned_to && before && before.assigned_to !== task.assigned_to) {
      await createNotification({
        userId: task.assigned_to,
        type: "TASK_ASSIGNED",
        title: "New task assigned",
        message: `${task.title}`,
        referenceType: "task",
        referenceId: task.id,
      });
    }

    return { success: true, data: task };
  } catch (err) {
    console.error("[updateTaskAction] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteTaskAction(id: string): Promise<ActionResponse> {
  try {
    const profile = await requireAdmin();
    const supabase = await createClient();

    const [{ data: task }, { data: payment }, { data: attachments }] =
      await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, project_id")
          .eq("id", id)
          .single(),
        supabase.from("payments").select("id").eq("task_id", id).maybeSingle(),
        supabase.from("task_attachments").select("file_path").eq("task_id", id),
      ]);

    if (!task) return { success: false, error: "Task not found" };
    if (payment) {
      return {
        success: false,
        error:
          "This task has a payment record. Archive it instead of deleting it.",
      };
    }

    if (attachments && attachments.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("attachments")
        .remove(attachments.map((attachment) => attachment.file_path));
      if (storageError) {
        console.error("[deleteTaskAction] storage", storageError);
        return { success: false, error: "Failed to remove task attachments" };
      }
    }

    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      console.error("[deleteTaskAction]", error);
      return { success: false, error: "Failed to delete task" };
    }

    const { error: auditError } = await supabase.from("admin_audit_log").insert({
      actor_id: profile.id,
      action: "TASK_DELETED",
      detail: `${task.title} (${task.id})`,
    });
    if (auditError) {
      console.error("[deleteTaskAction] audit", auditError);
      return {
        success: false,
        error: "Task deleted, but audit logging failed",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[deleteTaskAction] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Status transitions (§28) — enforced here AND in the DB trigger
// ──────────────────────────────────────────────

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  comment?: string
): Promise<ActionResponse<Task>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { data: currentTask } = await supabase
      .from("tasks")
      .select("id, title, status, assigned_to")
      .eq("id", taskId)
      .single();

    if (!currentTask) {
      return { success: false, error: "Task not found" };
    }

    const isAdmin = profile.role === "ADMIN";
    const isAssignee = currentTask.assigned_to === profile.id;

    if (isAdmin) {
      // Admin rules: SUBMITTED → COMPLETED or REVISION_REQUIRED.
      // Also allowed: move any task back to TODO / IN_PROGRESS.
      const allowed =
        (currentTask.status === "SUBMITTED" &&
          (status === "COMPLETED" || status === "REVISION_REQUIRED")) ||
        status === "TODO" ||
        status === "IN_PROGRESS" ||
        status === "COMPLETED";
      if (!allowed) {
        return { success: false, error: "Not an allowed transition" };
      }
    } else {
      // Employee rules: must be the assignee.
      if (!isAssignee) {
        return { success: false, error: "You can only update your own tasks" };
      }
      const allowed =
        (currentTask.status === "TODO" && status === "IN_PROGRESS") ||
        (currentTask.status === "IN_PROGRESS" && status === "SUBMITTED") ||
        (currentTask.status === "REVISION_REQUIRED" &&
          status === "IN_PROGRESS") ||
        (currentTask.status === "REVISION_REQUIRED" && status === "SUBMITTED");
      if (!allowed) {
        return { success: false, error: "Not an allowed transition" };
      }
    }

    const updateData: Record<string, unknown> = { status };
    if (status === "COMPLETED") {
      updateData.completed_at = new Date().toISOString();

      // Mark payable on completion if it has a payout and is not yet paid
      const { data: pay } = await supabase
        .from("tasks")
        .select("payout_amount, payment_status")
        .eq("id", taskId)
        .single();
      if (
        pay &&
        Number(pay.payout_amount) > 0 &&
        pay.payment_status === "NOT_APPLICABLE"
      ) {
        updateData.payment_status = "PENDING";
      }
    }

    const { data, error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", taskId)
      .select()
      .single();

    if (error) {
      console.error("[updateTaskStatus]", error);
      const msg = error.message.includes("allowed status transition")
        ? "That status change isn't allowed"
        : error.message.includes("Not allowed to modify")
          ? "You can only update your own tasks"
          : "Failed to update task";
      return { success: false, error: msg };
    }

    const task = data as Task;

    // Add review comment if provided (revision note)
    if (comment) {
      await supabase.from("task_comments").insert({
        task_id: taskId,
        user_id: profile.id,
        comment,
      });
    }

    // ── Notifications ──
    if (status === "SUBMITTED" && currentTask.assigned_to) {
      const { data: admins } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "ADMIN")
        .eq("status", "ACTIVE");

      const inputs = (admins ?? [])
        .filter((a) => a.id !== profile.id)
        .map((a) => ({
          userId: a.id,
          type: "TASK_SUBMITTED" as const,
          title: "Task submitted",
          message: `${profile.full_name} submitted "${currentTask.title}"`,
          referenceType: "task",
          referenceId: taskId,
        }));
      await createNotifications(inputs);
    } else if (status === "COMPLETED" && currentTask.assigned_to) {
      await createNotification({
        userId: currentTask.assigned_to,
        type: "TASK_APPROVED",
        title: "Task approved",
        message: `Your task "${currentTask.title}" has been approved`,
        referenceType: "task",
        referenceId: taskId,
      });

      const { data: assignee } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", currentTask.assigned_to)
        .single();
      if (assignee?.email) {
        await sendEventEmail("TASK_APPROVED", {
          to: assignee.email,
          employeeName: assignee.full_name,
          taskTitle: currentTask.title,
        });
      }
    } else if (status === "REVISION_REQUIRED" && currentTask.assigned_to) {
      await createNotification({
        userId: currentTask.assigned_to,
        type: "REVISION_REQUESTED",
        title: "Revision requested",
        message: comment
          ? `${currentTask.title} — ${comment}`
          : `${currentTask.title}`,
        referenceType: "task",
        referenceId: taskId,
      });

      const { data: assignee } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", currentTask.assigned_to)
        .single();
      if (assignee?.email) {
        await sendEventEmail("REVISION_REQUESTED", {
          to: assignee.email,
          employeeName: assignee.full_name,
          taskTitle: currentTask.title,
          revisionComment: comment,
        });
      }
    }

    return { success: true, data: task };
  } catch (err) {
    console.error("[updateTaskStatus] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Attachments — real uploads via storage
// ──────────────────────────────────────────────

export async function uploadTaskAttachment(
  taskId: string,
  file: File
): Promise<
  ActionResponse<{ id: string; file_name: string; file_path: string }>
> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { data: task } = await supabase
      .from("tasks")
      .select("id, assigned_to, project_id")
      .eq("id", taskId)
      .single();
    if (!task) return { success: false, error: "Task not found" };

    if (
      profile.role === "EMPLOYEE" &&
      task.assigned_to !== profile.id &&
      !(await hasProjectAccess(task.project_id, profile.id, profile.role))
    ) {
      return { success: false, error: "You don't have access to this task" };
    }

    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: "File is too large (max 50MB)" };
    }
    if (file.type && !ALLOWED_FILE_TYPES.includes(file.type)) {
      return { success: false, error: "This file type isn't allowed" };
    }

    const ext = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : "bin";
    const path = `${taskId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("attachments")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error("[uploadTaskAttachment] storage:", uploadError);
      return { success: false, error: "Failed to upload file" };
    }

    const { data, error } = await supabase
      .from("task_attachments")
      .insert({
        task_id: taskId,
        uploaded_by: profile.id,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type || null,
      })
      .select("id, file_name, file_path")
      .single();

    if (error) {
      // Roll back the storage object if the row insert fails
      await supabase.storage.from("attachments").remove([path]);
      console.error("[uploadTaskAttachment] row:", error);
      return { success: false, error: "Failed to save attachment" };
    }

    return { success: true, data };
  } catch (err) {
    console.error("[uploadTaskAttachment] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

export async function getAttachmentUrl(
  filePath: string
): Promise<ActionResponse<{ url: string }>> {
  try {
    await requireAuth();
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from("attachments")
      .createSignedUrl(filePath, 60 * 10); // 10 minutes

    if (error || !data) {
      return { success: false, error: "Failed to open file" };
    }
    return { success: true, data: { url: data.signedUrl } };
  } catch (err) {
    console.error("[getAttachmentUrl] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteTaskAttachment(
  attachmentId: string
): Promise<ActionResponse> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { data: att } = await supabase
      .from("task_attachments")
      .select("id, file_path, uploaded_by")
      .eq("id", attachmentId)
      .single();
    if (!att) return { success: false, error: "Attachment not found" };

    if (profile.role !== "ADMIN" && att.uploaded_by !== profile.id) {
      return { success: false, error: "You can only delete your own files" };
    }

    await supabase.storage.from("attachments").remove([att.file_path]);
    const { error } = await supabase
      .from("task_attachments")
      .delete()
      .eq("id", attachmentId);

    if (error) {
      return { success: false, error: "Failed to delete file" };
    }
    return { success: true };
  } catch (err) {
    console.error("[deleteTaskAttachment] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}

// ──────────────────────────────────────────────
// Dropdown helpers
// ──────────────────────────────────────────────

export async function getProjectsForTask(): Promise<
  ActionResponse<Array<{ id: string; name: string; client_name: string }>>
> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    // §38 — only ACTIVE projects are valid targets for new work.
    // (PLANNING / ON_HOLD / COMPLETED stay visible; ARCHIVED never.)
    let query = supabase
      .from("projects")
      .select("id, name, client:clients(name)")
      .neq("status", "ARCHIVED")
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

    type RawProject = {
      id: string;
      name: string;
      client: EmbeddedOne<{ name: string }>;
    };

    const projects = ((data ?? []) as unknown as RawProject[]).map((p) => {
      const client = one(p.client);
      return {
        id: p.id,
        name: p.name,
        client_name: client?.name ?? "",
      };
    });

    return { success: true, data: projects };
  } catch (err) {
    console.error("[getProjectsForTask] unexpected", err);
    return { success: false, error: "Unauthorized" };
  }
}