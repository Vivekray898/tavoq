import type { NotificationType } from "@/types/database";

/**
 * Phase 2 — push policy, deliberately free of "server-only" and of Supabase so
 * the rules can be unit-tested directly.
 *
 * lib/push.ts does the I/O; this module decides WHO should be told WHAT.
 */

export interface NotificationPreferences {
  push_enabled: boolean;
  task_assigned: boolean;
  status_changed: boolean;
  review_requested: boolean;
  comment_added: boolean;
  payment_paid: boolean;
  due_reminder: boolean;
}

/**
 * Every channel ON. Used when a user has no preferences row yet.
 *
 * This default matters: a missing row must NOT mean "no notifications".
 * Silently opting existing users out on deploy would be the worst possible
 * reading of "respect preferences".
 */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  push_enabled: true,
  task_assigned: true,
  status_changed: true,
  review_requested: true,
  comment_added: true,
  payment_paid: true,
  due_reminder: true,
};

/** Which preference flag gates a given notification type. */
const CHANNEL_BY_TYPE: Record<string, keyof Omit<NotificationPreferences, "push_enabled">> = {
  TASK_ASSIGNED: "task_assigned",
  PROJECT_ASSIGNED: "task_assigned",
  TASK_STATUS_CHANGED: "status_changed",
  REVISION_REQUESTED: "review_requested",
  TASK_SUBMITTED: "review_requested",
  COMMENT_ADDED: "comment_added",
  PAYMENT_PAID: "payment_paid",
  TASK_DUE_SOON: "due_reminder",
  TASK_OVERDUE: "due_reminder",
  TASK_APPROVED: "review_requested",
};

/**
 * Should a push be delivered for this notification type?
 *
 * The master `push_enabled` switch wins over everything. An unknown or
 * unmapped type defaults to allowed, so adding a new notification type later
 * cannot accidentally start being silently dropped.
 */
export function shouldSendPush(
  prefs: NotificationPreferences | null | undefined,
  type: NotificationType | string
): boolean {
  // No row means "never configured" -> all defaults, not opt-out.
  const p = prefs ?? DEFAULT_PREFERENCES;
  if (!p.push_enabled) return false;
  const channel = CHANNEL_BY_TYPE[type as string];
  if (!channel) return true;
  return p[channel] !== false;
}

/**
 * Build the dedupe key for a push delivery.
 *
 * The cron already dedupes through daily_reminder_log. This covers the
 * push-driven triggers, where a retried action (or a status change that
 * re-renders and re-fires) would otherwise buzz the user's phone twice.
 *
 * The key is bucketed by HOUR, and this distinction matters:
 *
 *   • Keying on the notification row id looks precise but is useless — every
 *     call inserts a NEW row with a new id, so the key is unique every time
 *     and nothing is ever suppressed.
 *   • Keying on reference alone would be worse: a second genuine comment on
 *     the same task would be silently swallowed.
 *
 * So the window is deliberately finite. A duplicate firing inside the same
 * hour collapses; a real event later on the same task still notifies.
 */
export function buildDedupeKey(
  userId: string,
  type: NotificationType | string,
  referenceId: string | null | undefined,
  now: Date = new Date()
): string {
  const hour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return `${userId}:${type}:${referenceId ?? "none"}:${hour}`;
}