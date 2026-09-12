// ──────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────

export type UserRole = "ADMIN" | "EMPLOYEE";

export type ProjectStatus =
  | "PLANNING"
  | "ACTIVE"
  | "ON_HOLD"
  | "COMPLETED"
  | "ARCHIVED";

export type ProjectMemberRole = "MEMBER" | "LEAD";

export type ResourceType =
  | "DRIVE"
  | "CANVA"
  | "GOOGLE_DOC"
  | "GOOGLE_SHEET"
  | "WEBSITE"
  | "OTHER";

export type TaskStatus =
  | "TODO"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "REVISION_REQUIRED"
  | "APPROVED"
  | "COMPLETED";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type PaymentStatus = "NOT_APPLICABLE" | "PENDING" | "PAID";

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_DUE_SOON"
  | "TASK_OVERDUE"
  | "TASK_SUBMITTED"
  | "REVISION_REQUESTED"
  | "TASK_APPROVED"
  | "PAYMENT_PAID"
  | "COMMENT_ADDED"
  | "PROJECT_ASSIGNED";

export type DevicePlatform = "ANDROID" | "IOS";

// ──────────────────────────────────────────────
// Table Types
// ──────────────────────────────────────────────

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: UserRole;
  phone: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  logo_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectMemberRole;
  created_at: string;
}

export interface ProjectResource {
  id: string;
  project_id: string;
  title: string;
  url: string;
  description: string | null;
  resource_type: ResourceType;
  created_by: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadline: string | null;
  payout_amount: number;
  payment_status: PaymentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  comment: string;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  task_id: string;
  amount: number;
  paid_at: string | null;
  paid_by: string | null;
  payment_note: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  reference_type: string | null;
  reference_id: string | null;
  read: boolean;
  created_at: string;
}

export interface UserDevice {
  id: string;
  user_id: string;
  push_token: string;
  platform: DevicePlatform;
  created_at: string;
  last_seen: string;
}

// ──────────────────────────────────────────────
// Joined / Extended Types
// ──────────────────────────────────────────────

export interface TaskWithRelations extends Task {
  project?: Project;
  assigned_user?: Profile;
  created_user?: Profile;
  comments_count?: number;
  attachments_count?: number;
}

export interface ProjectWithClient extends Project {
  client?: Client;
  members?: ProjectMember[];
  tasks_count?: number;
}

export interface ProjectWithRelations extends Project {
  client?: Client;
  members?: (ProjectMember & { user?: Profile })[];
  resources?: ProjectResource[];
  tasks?: Task[];
}

export interface TaskWithProject extends Task {
  project?: ProjectWithClient;
  assigned_user?: Profile;
}

export interface NotificationWithMeta extends Notification {
  reference?: Record<string, unknown>;
}

export interface PaymentWithRelations extends Payment {
  task?: Task;
  user?: Profile;
  paid_by_user?: Profile;
}

// ──────────────────────────────────────────────
// Form / Action Types
// ──────────────────────────────────────────────

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DashboardStats {
  activeProjects: number;
  activeTasks: number;
  dueToday: number;
  overdue: number;
  needsReview: number;
  pendingPayments: number;
  paidThisMonth: number;
}

export interface EmployeeDashboardStats {
  dueToday: number;
  needsReview: number;
  completed: number;
  pendingPayment: number;
}

// ──────────────────────────────────────────────
// Utility Types
// ──────────────────────────────────────────────

export type InsertProfile = Omit<Profile, "created_at" | "updated_at">;
export type UpdateProfile = Partial<
  Omit<Profile, "id" | "created_at" | "updated_at">
>;

export type InsertClient = Omit<Client, "id" | "created_at" | "updated_at">;
export type UpdateClient = Partial<Omit<Client, "id" | "created_at" | "updated_at">>;

export type InsertProject = Omit<Project, "id" | "created_at" | "updated_at">;
export type UpdateProject = Partial<Omit<Project, "id" | "created_at" | "updated_at">>;

export type InsertTask = Omit<Task, "id" | "created_at" | "updated_at" | "completed_at">;
export type UpdateTask = Partial<Omit<Task, "id" | "created_at">>;

export type InsertTaskComment = Omit<TaskComment, "id" | "created_at">;
export type InsertTaskAttachment = Omit<TaskAttachment, "id" | "created_at">;
export type InsertPayment = Omit<Payment, "id" | "created_at">;
export type InsertNotification = Omit<Notification, "id" | "created_at">;
