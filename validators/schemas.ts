import { z } from "zod";

// ──────────────────────────────────────────────
// Invitation Schemas (§9)
// ──────────────────────────────────────────────

export const invitationSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  role: z.enum(["SUPER_ADMIN", "MANAGER", "EMPLOYEE"]).default("EMPLOYEE"),
});

export type InvitationInput = z.infer<typeof invitationSchema>;

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
  // Payments live exclusively in the Payments workspace — task
  // create/edit never sends payout or payment-status fields.
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
// Payment Schemas (Phase 4C)
//
// Shared by the dialogs and the server actions, so the client can show a
// field error without a round trip while the server still enforces the
// same rule. Validating only on the client would let a crafted request
// mark a payment paid with no method, or create one with a negative
// amount.
//
// Zod v4 note: the v3 spelling `invalid_type_error` is rejected, and
// `z.enum` needs its members inlined unless they are a Record — hence
// the `as const` array is referenced through a literal here.
// ──────────────────────────────────────────────

export const PAYMENT_METHOD_VALUES = [
  "UPI",
  "BANK_TRANSFER",
  "CASH",
  "OTHER",
] as const;

export const LEDGER_TYPE_VALUES = [
  "TASK_PAYOUT",
  "CUSTOM",
  "BONUS",
  "ADJUSTMENT",
] as const;

export const paymentMethodSchema = z.enum(["UPI", "BANK_TRANSFER", "CASH", "OTHER"], {
  error: "Choose how this was paid",
});
export const ledgerPaymentTypeSchema = z.enum([
  "TASK_PAYOUT",
  "CUSTOM",
  "BONUS",
  "ADJUSTMENT",
]);

/** Optional free text: absent, empty and whitespace all mean "not given". */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined));

/** YYYY-MM-DD, or absent. A calendar day, never an instant. */
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .optional()
  .or(z.literal(""));

/**
 * Mark one or many payments as paid.
 *
 * Validates shape rather than state — the server rejects a payment that
 * is not PENDING — but an empty selection is refused, because a bulk
 * action that silently does nothing is the worst thing a dialog can do.
 *
 * `paid_on` stays a YYYY-MM-DD string. That is what a date input emits,
 * and it is also what the user meant: converting to an instant here
 * would shift the day by the server's offset and can file the payment
 * against the wrong date.
 */
export const markPaidSchema = z.object({
  payment_ids: z
    .array(z.string().uuid("Invalid payment reference"))
    .min(1, "Select at least one payment")
    .max(200, "Select fewer payments at a time"),
  method: paymentMethodSchema,
  paid_on: optionalDate,
  /** UTR / transaction id: optional for cash, useful for a transfer. */
  reference_number: optionalText(120, "The reference"),
  note: optionalText(500, "The note"),
  /** Object path in the private payment-proofs bucket, never a URL. */
  proof_path: optionalText(300, "The proof reference"),
});

export type MarkPaidInput = z.infer<typeof markPaidSchema>;

/**
 * Record a payment.
 *
 * The amount is validated as rupees — the same value the dialog parses —
 * and must be positive with at most two decimals. Zero and negatives are
 * refused because a real payout cannot be either; a deduction goes
 * through paymentAdjustmentSchema, which is signed on purpose.
 */
export const createPaymentSchema = z.object({
  employee_id: z.string().uuid("Choose an employee"),
  type: ledgerPaymentTypeSchema.default("CUSTOM"),
  title: z
    .string()
    .trim()
    .min(2, "Add a short title")
    .max(140, "Title must be 140 characters or fewer"),
  amount: z
    .number({ error: "Enter an amount" })
    .positive("Amount must be more than zero")
    .max(1_000_000_000, "That amount looks too large"),
  project_id: z.string().uuid().optional().or(z.literal("")),
  due_date: optionalDate,
  notes: optionalText(500, "The notes"),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

/**
 * Bonus or deduction on an already-paid payment.
 *
 * Signed and non-zero: an adjustment of zero records nothing while
 * looking like it recorded something, and the ledger renders the sign.
 */
export const paymentAdjustmentSchema = z.object({
  parent_payment_id: z.string().uuid("Invalid payment reference"),
  amount: z
    .number({ error: "Enter an amount" })
    .refine((n) => n !== 0, "The adjustment must not be zero"),
  reason: z
    .string()
    .trim()
    .min(2, "Give a reason")
    .max(300, "Reason must be 300 characters or fewer"),
});

export type PaymentAdjustmentInput = z.infer<typeof paymentAdjustmentSchema>;

/**
 * Cancel or reverse a payment.
 *
 * A reason is mandatory on both. The database enforces it too
 * (payments_cancel_complete); this exists so the dialog explains the
 * rule before the request is sent rather than after it is refused.
 */
export const reversePaymentSchema = z.object({
  payment_id: z.string().uuid("Invalid payment reference"),
  reason: z
    .string()
    .trim()
    .min(4, "Give a reason of at least 4 characters")
    .max(300, "Reason must be 300 characters or fewer"),
});

export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

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

