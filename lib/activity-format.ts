import type { ActivityType } from "@/types/database";

const HUMAN_LABELS: Record<ActivityType, string> = {
  TASK_CREATED: "created task",
  TASK_ASSIGNED: "was assigned",
  STATUS_CHANGED: "changed status",
  DEADLINE_CHANGED: "changed the deadline",
  PRIORITY_CHANGED: "changed priority",
  COMMENT_ADDED: "commented",
  ATTACHMENT_ADDED: "uploaded",
  ATTACHMENT_DELETED: "removed file",
  SUBTASK_ADDED: "added checklist item",
  SUBTASK_COMPLETED: "completed a checklist item",
  LABEL_ADDED: "added label",
  LABEL_REMOVED: "removed label",
  RESOURCE_ADDED: "added resource",
  RESOURCE_REMOVED: "removed resource",
  PAYMENT_PAID: "marked payment paid",
  TASK_COMPLETED: "completed",
};

/**
 * Render one activity event as a human sentence.
 * Pure helper shared by client components (must NOT live in a
 * "use server" module, where all exports must be async actions).
 */
export function formatActivityText(
  actor: string | null,
  type: ActivityType,
  detail: string | null,
  taskTitle: string | null
): string {
  const who = actor ?? "Someone";
  const what = HUMAN_LABELS[type] ?? type;
  const parts = [who, what];
  if (detail) parts.push(detail);
  if (taskTitle && type !== "TASK_CREATED" && type !== "TASK_COMPLETED") {
    parts.push(`on "${taskTitle}"`);
  }
  return parts.join(" ");
}
