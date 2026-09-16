"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { commentSchema } from "@/validators/schemas";
import type { ActionResponse, TaskComment } from "@/types/database";

export async function addCommentAction(
  taskId: string,
  rawComment: string
): Promise<ActionResponse<TaskComment & { user: { id: string; full_name: string; avatar_url: string | null } }>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const validated = commentSchema.safeParse({ comment: rawComment });
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid comment" };
    }
    const comment = validated.data.comment;

    // Verify access: assignee, project member, or admin
    const { data: task } = await supabase
      .from("tasks")
      .select("id, title, assigned_to, project_id")
      .eq("id", taskId)
      .single();
    if (!task) return { success: false, error: "Task not found" };

    if (profile.role === "EMPLOYEE") {
      const isAssignee = task.assigned_to === profile.id;
      let isMember = false;
      if (!isAssignee) {
        const { data: member } = await supabase
          .from("project_members")
          .select("id")
          .eq("project_id", task.project_id)
          .eq("user_id", profile.id)
          .maybeSingle();
        isMember = !!member;
      }
      if (!isAssignee && !isMember) {
        return { success: false, error: "You don't have access to this task" };
      }
    }

    const { data, error } = await supabase
      .from("task_comments")
      .insert({
        task_id: taskId,
        user_id: profile.id,
        comment,
      })
      .select("*, user:profiles(id, full_name, avatar_url)")
      .single();

    if (error) {
      console.error("[addCommentAction]", error);
      return { success: false, error: "Failed to send message" };
    }

    // Notify the other side (assignee ↔ admins), excluding the author
    const admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const recipientIds = new Set<string>();

    if (task.assigned_to && task.assigned_to !== profile.id) {
      recipientIds.add(task.assigned_to);
    }
    if (profile.role === "EMPLOYEE") {
      const { data: admins } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "ADMIN")
        .eq("active", true);
      (admins ?? []).forEach((a) => recipientIds.add(a.id));
    }
    recipientIds.delete(profile.id);

    if (recipientIds.size > 0) {
      await Promise.all(
        Array.from(recipientIds).map((userId) =>
          createNotification({
            userId,
            type: "COMMENT_ADDED",
            title: "New comment",
            message: `${profile.full_name} on "${task.title}": ${comment.slice(0, 80)}${comment.length > 80 ? "…" : ""}`,
            referenceType: "task",
            referenceId: taskId,
          })
        )
      );
    }

    return {
      success: true,
      data: data as TaskComment & {
        user: { id: string; full_name: string; avatar_url: string | null };
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
