"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResponse, TaskComment } from "@/types/database";

export async function addCommentAction(
  taskId: string,
  comment: string
): Promise<ActionResponse<TaskComment>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

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
      return { success: false, error: "Failed to add comment" };
    }

    // Determine recipients: admins + the task's assignee (excluding the commenter)
    const admin = createAdminClient();
    const { data: task } = await admin
      .from("tasks")
      .select("title, assigned_to")
      .eq("id", taskId)
      .single();

    const recipientIds = new Set<string>();

    if (task?.assigned_to && task.assigned_to !== profile.id) {
      recipientIds.add(task.assigned_to);
    }

    if (profile.role === "EMPLOYEE") {
      // Employee commented → notify all admins
      const { data: admins } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "ADMIN")
        .eq("active", true);
      (admins ?? []).forEach((a) => recipientIds.add(a.id));
    }

    // If admin commented and the task is assigned, assignee was already added above.

    if (recipientIds.size > 0) {
      await Promise.all(
        Array.from(recipientIds).map((userId) =>
          createNotification({
            userId,
            type: "COMMENT_ADDED",
            title: "New comment",
            message: `${profile.full_name} commented on "${task?.title ?? "a task"}": ${comment.slice(0, 80)}${comment.length > 80 ? "…" : ""}`,
            referenceType: "task",
            referenceId: taskId,
          })
        )
      );
    }

    return { success: true, data: data as TaskComment };
  } catch (err) {
    console.error("[addCommentAction] error:", err);
    return { success: false, error: "Unauthorized" };
  }
}