import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import {
  sendTaskAssignedEmail,
  sendRevisionRequestedEmail,
  sendTaskApprovedEmail,
  sendPaymentPaidEmail,
} from "@/lib/email";
import type { NotificationType } from "@/types/database";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string | null;
}

interface EmailPayload {
  to: string;
  employeeName: string;
  taskTitle: string;
  revisionComment?: string;
  amount?: number;
  paymentNote?: string;
  projectName?: string;
  clientName?: string;
  deadline?: string | null;
  payoutAmount?: number;
}

/**
 * The ONLY path through which notifications are created.
 * Uses the service-role client so RLS cannot block the insert
 * and end users cannot forge notifications via the anon key.
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

  // §20 — deliver as a real browser/system notification too
  // (fire-and-forget; requires VAPID keys to be configured).
  void sendPushToUser(input.userId, {
    title: input.title,
    body: input.message,
    url:
      input.referenceType === "task" && input.referenceId
        ? `/tasks/${input.referenceId}`
        : input.referenceType === "project" && input.referenceId
          ? `/projects/${input.referenceId}`
          : "/notifications",
    tag: input.type,
  });

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

/**
 * Check an employee's email preference for a notification type.
 * Defaults to enabled unless the user explicitly turned it off.
 */
export async function emailEnabledFor(
  userId: string,
  key: "task_assigned" | "revision_requested" | "task_approved" | "payment_paid"
): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("profiles")
      .select("notification_prefs")
      .eq("id", userId)
      .single();

    const prefs = (data?.notification_prefs ?? {}) as Record<string, unknown>;
    return prefs[key] !== false;
  } catch {
    return true;
  }
}

/**
 * Fire an email for an important event, gated by the user's preferences.
 * Never throws — email must not break the main action.
 */
export async function sendEventEmail(
  type: "TASK_ASSIGNED" | "REVISION_REQUESTED" | "TASK_APPROVED" | "PAYMENT_PAID",
  payload: EmailPayload
) {
  try {
    const prefKey =
      type === "TASK_ASSIGNED"
        ? "task_assigned"
        : type === "REVISION_REQUESTED"
          ? "revision_requested"
          : type === "TASK_APPROVED"
            ? "task_approved"
            : "payment_paid";

    if (!(await emailEnabledFor(payload.to, prefKey))) return;

    switch (type) {
      case "TASK_ASSIGNED":
        await sendTaskAssignedEmail(
          payload.to,
          payload.employeeName,
          payload.taskTitle,
          payload.projectName ?? "",
          payload.clientName ?? "",
          payload.deadline ?? null,
          payload.payoutAmount ?? 0
        );
        break;
      case "REVISION_REQUESTED":
        await sendRevisionRequestedEmail(
          payload.to,
          payload.employeeName,
          payload.taskTitle,
          payload.revisionComment
        );
        break;
      case "TASK_APPROVED":
        await sendTaskApprovedEmail(payload.to, payload.employeeName, payload.taskTitle);
        break;
      case "PAYMENT_PAID":
        await sendPaymentPaidEmail(
          payload.to,
          payload.employeeName,
          payload.taskTitle,
          payload.amount ?? 0,
          payload.paymentNote
        );
        break;
    }
  } catch (err) {
    console.error("[sendEventEmail] failed:", err);
  }
}
