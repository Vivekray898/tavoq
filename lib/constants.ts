import type {
  UserRole,
  ProjectStatus,
  TaskStatus,
  TaskPriority,
  PaymentStatus,
  ResourceType,
  NotificationType,
} from "@/types/database";

// ──────────────────────────────────────────────
// Role Labels
// ──────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  EMPLOYEE: "Employee",
};

// ──────────────────────────────────────────────
// Project Status
// ──────────────────────────────────────────────

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  PLANNING: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  ON_HOLD: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  COMPLETED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  ARCHIVED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

// ──────────────────────────────────────────────
// Task Status
// ──────────────────────────────────────────────

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Submitted",
  REVISION_REQUIRED: "Revision Required",
  APPROVED: "Approved",
  COMPLETED: "Completed",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SUBMITTED: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  REVISION_REQUIRED: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  COMPLETED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

// Kanban columns order
export const KANBAN_COLUMNS: TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVISION_REQUIRED",
  "COMPLETED",
];

// ──────────────────────────────────────────────
// Task Priority
// ──────────────────────────────────────────────

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  MEDIUM: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  HIGH: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  URGENT: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

// ──────────────────────────────────────────────
// Payment Status
// ──────────────────────────────────────────────

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  NOT_APPLICABLE: "N/A",
  PENDING: "Pending",
  PAID: "Paid",
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  NOT_APPLICABLE: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
  PENDING: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  PAID: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

// ──────────────────────────────────────────────
// Resource Type
// ──────────────────────────────────────────────

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  DRIVE: "Google Drive",
  CANVA: "Canva",
  GOOGLE_DOC: "Google Doc",
  GOOGLE_SHEET: "Google Sheet",
  WEBSITE: "Website",
  OTHER: "Other",
};

// ──────────────────────────────────────────────
// Notification Type
// ──────────────────────────────────────────────

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  TASK_ASSIGNED: "New task assigned",
  TASK_DUE_SOON: "Task due soon",
  TASK_OVERDUE: "Task overdue",
  TASK_SUBMITTED: "Task submitted",
  REVISION_REQUESTED: "Revision requested",
  TASK_APPROVED: "Task approved",
  PAYMENT_PAID: "Payment marked as paid",
  COMMENT_ADDED: "New comment",
  PROJECT_ASSIGNED: "Assigned to project",
};

// ──────────────────────────────────────────────
// Currency
// ──────────────────────────────────────────────

export const CURRENCY_SYMBOL = "₹";
export const CURRENCY_CODE = "INR";

// ──────────────────────────────────────────────
// File Upload
// ──────────────────────────────────────────────

export const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export const ALLOWED_FILE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".pdf",
  ".mp4",
  ".mov",
  ".zip",
  ".docx",
  ".xlsx",
];

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ──────────────────────────────────────────────
// Navigation
// ──────────────────────────────────────────────

export const APP_NAME = "Taskora";

export const ADMIN_NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { label: "Clients", href: "/clients", icon: "Building2" },
  { label: "Projects", href: "/projects", icon: "FolderKanban" },
  { label: "Tasks", href: "/tasks", icon: "CheckSquare" },
  { label: "Employees", href: "/employees", icon: "Users" },
  { label: "Payments", href: "/payments", icon: "IndianRupee" },
  { label: "Notifications", href: "/notifications", icon: "Bell" },
  { label: "Settings", href: "/settings", icon: "Settings" },
] as const;

export const EMPLOYEE_NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { label: "My Tasks", href: "/tasks", icon: "CheckSquare" },
  { label: "Projects", href: "/projects", icon: "FolderKanban" },
  { label: "Notifications", href: "/notifications", icon: "Bell" },
  { label: "Profile", href: "/profile", icon: "User" },
] as const;
