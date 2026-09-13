import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationType } from "@/types/database";

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string | null;
}

/**
 * Insert a notification row for a specific user.
 * Uses the service-role client so RLS doesn't block the insert.
 */
export async function createNotification(input: CreateNotificationInput) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    reference_type: input.referenceType ?? null,
    reference_id: input.referenceId ?? null,
    read: false,
  });

  if (error) {
    console.error("[createNotification] insert failed:", error);
    return { success: false as const, error: error.message };
  }
  return { success: true as const };
}

/**
 * Insert the same notification for many users at once.
 */
export async function createNotifications(
  inputs: CreateNotificationInput[]
) {
  if (inputs.length === 0) return { success: true as const };

  const supabase = createAdminClient();

  const { error } = await supabase.from("notifications").insert(
    inputs.map((input) => ({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      read: false,
    }))
  );

  if (error) {
    console.error("[createNotifications] insert failed:", error);
    return { success: false as const, error: error.message };
  }
  return { success: true as const };
}