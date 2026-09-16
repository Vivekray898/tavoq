import { z } from "zod";

// ──────────────────────────────────────────────
// Profile Schemas
// ──────────────────────────────────────────────

export const profileSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().optional().or(z.literal("")),
  avatar_url: z.string().url("Please enter a valid URL").optional().or(z.literal("")),
});

export type ProfileInput = z.infer<typeof profileSchema>;

// ──────────────────────────────────────────────
// Client Schemas
// ──────────────────────────────────────────────

export const clientSchema = z.object({
  name: z.string().min(1, "Client name is required"),
  company_name: z.string().optional().or(z.literal("")),
  email: z.string().email("Please enter a valid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  website: z
    .string()
    .url("Please enter a valid URL")
    .optional()
    .or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  logo_url: z.string().url("Please enter a valid URL").optional().or(z.literal("")),
  active: z.boolean().optional(),
});

export type ClientInput = z.infer<typeof clientSchema>;

// ──────────────────────────────────────────────
// Project Schemas
// ──────────────────────────────────────────────

export const projectSchema = z.object({
  client_id: z.string().uuid("Please select a client"),
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional().or(z.literal("")),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional(),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
});

export type ProjectInput = z.infer<typeof projectSchema>;

// ──────────────────────────────────────────────
// Project Member Schema
// ──────────────────────────────────────────────

export const projectMemberSchema = z.object({
  user_id: z.string().uuid("Please select an employee"),
  role: z.enum(["MEMBER", "LEAD"]).optional(),
});

export type ProjectMemberInput = z.infer<typeof projectMemberSchema>;

// ──────────────────────────────────────────────
// Project Resource Schema
// ──────────────────────────────────────────────

export const projectResourceSchema = z.object({
  title: z.string().min(1, "Title is required"),
  url: z
    .string()
    .url("Please enter a valid URL")
    .refine(
      (url) => url.startsWith("http://") || url.startsWith("https://"),
      "URL must start with http:// or https://"
    ),
  description: z.string().optional().or(z.literal("")),
  resource_type: z
    .enum(["DRIVE", "CANVA", "GOOGLE_DOC", "GOOGLE_SHEET", "WEBSITE", "OTHER"])
    .optional(),
});

export type ProjectResourceInput = z.infer<typeof projectResourceSchema>;

// ──────────────────────────────────────────────
// Task Schemas
// ──────────────────────────────────────────────

export const taskSchema = z.object({
  project_id: z.string().uuid("Please select a project"),
  assigned_to: z.string().uuid().optional().or(z.literal("")),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional().or(z.literal("")),
  status: z
    .enum(["TODO", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUIRED", "COMPLETED"])
    .optional(),
  priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  deadline: z.string().optional().or(z.literal("")),
  payout_amount: z
    .number()
    .min(0, "Payout cannot be negative")
    .optional(),
  payment_status: z
    .enum(["NOT_APPLICABLE", "PENDING", "PAID"])
    .optional(),
  label_ids: z.array(z.string().uuid()).optional(),
  subtasks: z
    .array(z.object({ title: z.string().min(1, "Subtask title is required") }))
    .max(20, "Too many subtasks")
    .optional(),
});

export type TaskInput = z.infer<typeof taskSchema>;

export const taskStatusSchema = z.object({
  status: z.enum([
    "TODO",
    "IN_PROGRESS",
    "SUBMITTED",
    "REVISION_REQUIRED",
    "COMPLETED",
  ]),
  comment: z.string().optional().or(z.literal("")),
});

export type TaskStatusInput = z.infer<typeof taskStatusSchema>;

// ──────────────────────────────────────────────
// Label Schemas (§19)
// ──────────────────────────────────────────────

export const labelSchema = z.object({
  name: z.string().min(1, "Label name is required").max(30, "Label name is too long"),
  color: z
    .enum(["GRAY", "RED", "ORANGE", "AMBER", "GREEN", "TEAL", "BLUE", "VIOLET", "PINK"])
    .optional(),
});

export type LabelInput = z.infer<typeof labelSchema>;

// ──────────────────────────────────────────────
// Subtask Schema (§21)
// ──────────────────────────────────────────────

export const subtaskSchema = z.object({
  title: z.string().min(1, "Subtask title is required").max(200, "Subtask is too long"),
});

export type SubtaskInput = z.infer<typeof subtaskSchema>;

// ──────────────────────────────────────────────
// Saved Filter Schema (§25)
// ──────────────────────────────────────────────

export const savedFilterSchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name is too long"),
  filters: z.record(z.string(), z.unknown()),
});

export type SavedFilterInput = z.infer<typeof savedFilterSchema>;

// ──────────────────────────────────────────────
// Comment Schema
// ──────────────────────────────────────────────

export const commentSchema = z.object({
  comment: z.string().min(1, "Comment cannot be empty").max(2000, "Comment is too long"),
});

export type CommentInput = z.infer<typeof commentSchema>;

// ──────────────────────────────────────────────
// Payment Schema
// ──────────────────────────────────────────────

export const markPaidSchema = z.object({
  payment_note: z.string().optional().or(z.literal("")),
});

export type MarkPaidInput = z.infer<typeof markPaidSchema>;

// ──────────────────────────────────────────────
// Settings Schema
// ──────────────────────────────────────────────

export const settingsSchema = z.object({
  agency_name: z.string().min(1, "Agency name is required"),
  agency_logo: z.string().url("Please enter a valid URL").optional().or(z.literal("")),
  currency: z.string().optional(),
  timezone: z.string().optional(),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

// ──────────────────────────────────────────────
// Filter Schemas
// ──────────────────────────────────────────────

export const taskFilterSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigned_to: z.string().optional(),
  project_id: z.string().optional(),
  label_id: z.string().optional(),
  client_id: z.string().optional(),
  payment_status: z.string().optional(),
  overdue: z.boolean().optional(),
});

export type TaskFilterInput = z.infer<typeof taskFilterSchema>;
