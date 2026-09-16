import type {
  UserRole,
  ProjectStatus,
  TaskStatus,
  TaskPriority,
  PaymentStatus,
  ResourceType,
  LabelColor,
} from "@/types/database";

// ──────────────────────────────────────────────
// Brand
// ──────────────────────────────────────────────

export const APP_NAME = "Taskora";

// ──────────────────────────────────────────────
// Status model (§27) — exactly five task statuses
// ──────────────────────────────────────────────

/**
 * §28 — allowed status transitions, shared by the server action and
 * mirrored in the DB trigger (migration 002).
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["COMPLETED", "REVISION_REQUIRED"],
  REVISION_REQUIRED: ["IN_PROGRESS", "SUBMITTED"],
  COMPLETED: [],
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  REVISION_REQUIRED: "Revision requested",
  COMPLETED: "Completed",
};

/**
 * Subtle status indicators (§11): a colored dot + neutral text,
 * not giant colored pills.
 */
export const TASK_STATUS_DOTS: Record<TaskStatus, string> = {
  TODO: "bg-gray-400 dark:bg-gray-500",
  IN_PROGRESS: "bg-blue-500",
  SUBMITTED: "bg-violet-500",
  REVISION_REQUIRED: "bg-orange-500",
  COMPLETED: "bg-emerald-500",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  SUBMITTED: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  REVISION_REQUIRED: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  COMPLETED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

/** Ordering used in lists and filters */
export const TASK_STATUSES: TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVISION_REQUIRED",
  "COMPLETED",
];

/** Statuses that still need someone to act */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVISION_REQUIRED",
];

// ──────────────────────────────────────────────
// Priority (§20) — None/Low/Medium/High/Urgent
// ──────────────────────────────────────────────

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  NONE: "None",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  NONE: "bg-muted text-muted-foreground",
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-muted text-muted-foreground",
  HIGH: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  URGENT: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

/** Priorities shown as tags in lists (subtle ones are hidden) */
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  NONE: "",
  LOW: "bg-gray-300 dark:bg-gray-600",
  MEDIUM: "bg-yellow-400",
  HIGH: "bg-orange-500",
  URGENT: "bg-red-500",
};

// ──────────────────────────────────────────────
// Label colors (§19)
// ──────────────────────────────────────────────

export const LABEL_COLORS: Record<LabelColor, string> = {
  GRAY: "bg-gray-400",
  RED: "bg-red-400",
  ORANGE: "bg-orange-400",
  AMBER: "bg-amber-400",
  GREEN: "bg-emerald-400",
  TEAL: "bg-teal-400",
  BLUE: "bg-blue-400",
  VIOLET: "bg-violet-400",
  PINK: "bg-pink-400",
};

export const LABEL_CHIP: Record<LabelColor, string> = {
  GRAY: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  RED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  ORANGE: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  AMBER: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  GREEN: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  TEAL: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  BLUE: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  VIOLET: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  PINK: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
};

// ──────────────────────────────────────────────
// Project status
// ──────────────────────────────────────────────

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  PLANNING: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  ON_HOLD: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  COMPLETED: "bg-muted text-muted-foreground",
  ARCHIVED: "bg-muted text-muted-foreground",
};

// ──────────────────────────────────────────────
// Payment status
// ──────────────────────────────────────────────

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  NOT_APPLICABLE: "No payout",
  PENDING: "Payment pending",
  PAID: "Paid",
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  NOT_APPLICABLE: "bg-muted text-muted-foreground",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

// ──────────────────────────────────────────────
// Resource types
// ──────────────────────────────────────────────

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  DRIVE: "Google Drive",
  CANVA: "Canva",
  GOOGLE_DOC: "Google Doc",
  GOOGLE_SHEET: "Google Sheet",
  WEBSITE: "Website",
  OTHER: "Link",
};

// ──────────────────────────────────────────────
// Roles
// ──────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  EMPLOYEE: "Employee",
};

// ──────────────────────────────────────────────
// Currency & files
// ──────────────────────────────────────────────

export const CURRENCY_SYMBOL = "₹";
export const CURRENCY_CODE = "INR";

export const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "application/zip",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
