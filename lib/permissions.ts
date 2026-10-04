import type { UserRole } from "@/types/database";

/**
 * The role hierarchy, in one place.
 *
 *   SUPER_ADMIN — org owner. Configuration, destructive actions, role
 *                 changes. Cannot be touched by a manager.
 *   MANAGER     — day-to-day operations, scoped to the projects they
 *                 are a member of. May approve/suspend employees and
 *                 run payments, but may never change a role, delete
 *                 anything hard, or reach settings.
 *   EMPLOYEE    — unchanged. Own tasks only.
 *
 * This module is deliberately pure (no Supabase, no React) so the
 * matrix is unit-testable without a database, and so the server actions
 * and the UI import the exact same predicates — a control can never be
 * hidden in the UI while still enforced, or shown in the UI but
 * rejected by the action.
 *
 * The RLS layer (migration 013) mirrors this file independently. RLS is
 * the real boundary; this is the readable mirror of it.
 */

export const ROLES = ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as const;

/** Roles ordered from least to most privileged. */
export const ROLE_RANK: Record<UserRole, number> = {
  EMPLOYEE: 1,
  MANAGER: 2,
  SUPER_ADMIN: 3,
};

export function isSuperAdmin(role: UserRole | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

export function isManager(role: UserRole | null | undefined): boolean {
  return role === "MANAGER";
}

export function isEmployee(role: UserRole | null | undefined): boolean {
  return role === "EMPLOYEE";
}

/** SUPER_ADMIN or MANAGER — the "operational staff" set. */
export function isStaff(role: UserRole | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "MANAGER";
}

/**
 * True when the role was retired by migration 013.
 *
 * Reads from a `unknown` rather than UserRole on purpose: rows that
 * predate the migration, or JSON payloads typed loosely elsewhere in
 * the app, can still carry the old string, and treating it as silently
 * equivalent to EMPLOYEE would quietly strip someone's access. A
 * retired value grants nothing and is reported as retired so callers
 * can send the user somewhere that explains it.
 */
export function isRetiredRole(role: unknown): boolean {
  return role === "ADMIN";
}

/** Every capability, as one closed union so typos fail at compile time. */
export type Permission =
  // Clients
  | "clients.manage"
  | "clients.delete"
  // Projects
  | "projects.manage"
  | "projects.delete"
  | "projects.members.manage"
  // Tasks
  | "tasks.create"
  | "tasks.updateAny"
  | "tasks.assign"
  | "tasks.delete"
  // People
  | "profiles.viewTeam"
  | "profiles.approve"
  | "profiles.suspend"
  | "profiles.changeRole"
  // Money
  | "payments.viewAll"
  | "payments.manage"
  | "payments.markPaid"
  | "payments.delete"
  // Org
  | "invitations.send"
  | "settings.manage"
  | "audit.view";

/**
 * The matrix.
 *
 * Super-admin-only entries are the destructive or configuration
 * actions: a manager running their own projects must never be able to
 * remove data, reconfigure the org, or promote anyone.
 */
const MATRIX: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: [
    "clients.manage",
    "clients.delete",
    "projects.manage",
    "projects.delete",
    "projects.members.manage",
    "tasks.create",
    "tasks.updateAny",
    "tasks.assign",
    "tasks.delete",
    "profiles.viewTeam",
    "profiles.approve",
    "profiles.suspend",
    "profiles.changeRole",
    "payments.viewAll",
    "payments.manage",
    "payments.markPaid",
    "payments.delete",
    "invitations.send",
    "settings.manage",
    "audit.view",
  ],
  MANAGER: [
    "clients.manage",
    "projects.manage",
    "projects.members.manage",
    "tasks.create",
    "tasks.updateAny",
    "tasks.assign",
    "profiles.viewTeam",
    "profiles.approve",
    "profiles.suspend",
    "payments.viewAll",
    "payments.manage",
    "payments.markPaid",
    "invitations.send",
    "audit.view",
  ],
  EMPLOYEE: [],
};

/** Permissions a MANAGER may only exercise inside their own projects. */
const PROJECT_SCOPED: ReadonlySet<Permission> = new Set<Permission>([
  "projects.manage",
  "projects.members.manage",
  "tasks.create",
  "tasks.updateAny",
  "tasks.assign",
]);

/** Does this permission require project membership for a MANAGER? */
export function isProjectScoped(permission: Permission): boolean {
  return PROJECT_SCOPED.has(permission);
}

/**
 * Resource context for a permission check.
 *
 * Passing this makes the scope check part of the same call, so the
 * safe path is the default. Callers that omit it get `false` for any
 * project-scoped permission when the actor is a manager — failing
 * closed rather than granting globally.
 */
export interface Scope {
  /** The project the record belongs to, when it has one. */
  projectId?: string | null;
  /** Every project the actor is a member of. */
  memberProjectIds?: Iterable<string> | null;
}

/**
 * Does this role hold this permission, within this scope?
 *
 * Super admins are unrestricted. Managers hold project-scoped
 * permissions only inside a project they belong to. Employees hold
 * nothing from this matrix (their access is row-scoped by RLS and by
 * the assignee checks in the actions themselves).
 */
export function can(
  role: UserRole | null | undefined,
  permission: Permission,
  scope?: Scope
): boolean {
  if (!role || isRetiredRole(role)) return false;
  if (!MATRIX[role].includes(permission)) return false;

  // Only managers are ever restricted by project scope.
  if (role !== "MANAGER") return true;
  if (!isProjectScoped(permission)) return true;

  const projectId = scope?.projectId;
  const memberProjectIds = scope?.memberProjectIds;
  if (!projectId || !memberProjectIds) return false; // fail closed

  for (const id of memberProjectIds) {
    if (id === projectId) return true;
  }
  return false;
}

/**
 * May this actor administer a specific project?
 * Super admin always; manager only as a member. Mirrors
 * public.can_manage_project(project_id) in migration 013.
 */
export function canManageProject(
  role: UserRole | null | undefined,
  projectId: string | null | undefined,
  memberProjectIds: Iterable<string> | null | undefined
): boolean {
  if (!role || isRetiredRole(role)) return false;
  if (isSuperAdmin(role)) return true;
  if (!isManager(role) || !projectId || !memberProjectIds) return false;
  for (const id of memberProjectIds) {
    if (id === projectId) return true;
  }
  return false;
}

/**
 * Which roles may this actor grant to someone else?
 *
 * Covers both inviting a new person and approving a pending signup:
 * both write `profiles.role`, so both are clamped the same way. A
 * manager can onboard day-to-day staff but cannot mint a peer.
 */
export function invitableRoles(actorRole: UserRole | null | undefined): UserRole[] {
  if (isSuperAdmin(actorRole)) return ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"];
  if (isManager(actorRole)) return ["EMPLOYEE"];
  return [];
}

export type ProfileAction =
  | "APPROVE"
  | "REJECT"
  | "SUSPEND"
  | "REACTIVATE"
  | "ROLE_CHANGED";

/**
 * May this actor run `action` against a target profile, setting it to
 * `requestedRole`?
 *
 * `requestedRole` is a required argument by design. It is the value
 * manage_profile_lifecycle will write to profiles.role, and leaving it
 * out is what let a manager approve a pending user as SUPER_ADMIN:
 * APPROVE looked harmless because the *target* was a null-role
 * employee, while the damage came from the role being written.
 *
 * Rules:
 *  - role changes are super-admin only;
 *  - a manager may only ever act on EMPLOYEE targets;
 *  - a manager may only ever grant EMPLOYEE;
 *  - a manager may never act on a MANAGER or SUPER_ADMIN target.
 *
 * Note that APPROVE grants EMPLOYEE to a manager, because onboarding
 * a plain employee is precisely what managers are for. The clamp is on
 * the role being GRANTED, not on the action name — that is what stops
 * a manager passing requested_role = 'SUPER_ADMIN' through APPROVE.
 */
export function canManageProfile(
  actorRole: UserRole | null | undefined,
  targetRole: UserRole | null | undefined,
  action: ProfileAction,
  requestedRole?: UserRole | null
): boolean {
  if (!actorRole || isRetiredRole(actorRole) || !isStaff(actorRole)) return false;

  // Changing a role is a configuration action: super admin only.
  if (action === "ROLE_CHANGED") return isSuperAdmin(actorRole);

  // Whatever role this action would write must be one the actor is
  // allowed to grant. APPROVE is the important case — it sets role as
  // well as status, so it is gated exactly like ROLE_CHANGED.
  if (requestedRole && !invitableRoles(actorRole).includes(requestedRole)) {
    return false;
  }

  // A manager may only act on plain employees. A null-role target is a
  // pending signup — fine, since that is exactly what managers approve.
  if (!isSuperAdmin(actorRole) && targetRole != null && targetRole !== "EMPLOYEE") {
    return false;
  }

  return true;
}

/**
 * May this actor move `task`'s status?
 * Staff act on tasks in their projects; an employee only on their own.
 */
export function canChangeTaskStatus(
  actorRole: UserRole | null | undefined,
  task: { assignedTo: string | null; projectId: string | null },
  actorId: string | null,
  memberProjectIds: Iterable<string> | null | undefined
): boolean {
  if (!actorRole || isRetiredRole(actorRole)) return false;
  if (isSuperAdmin(actorRole)) return true;
  if (isManager(actorRole)) {
    return canManageProject(actorRole, task.projectId, memberProjectIds);
  }
  return actorId != null && task.assignedTo === actorId;
}

/**
 * Where a signed-in account belongs, from its status and role.
 *
 * Single source of truth for post-sign-in routing: the OAuth callback
 * and the /login page both call this, so the two can never disagree.
 * That disagreement is what produced the redirect loop — the callback
 * sent a signed-in user to one place, /login re-offered "Continue with
 * Google", the callback failed for the same reason, and the pair
 * bounced indefinitely.
 *
 *   no profile / null role / not ACTIVE → /pending
 *   SUSPENDED                           → /suspended
 *   SUPER_ADMIN                         → /admin
 *   MANAGER / EMPLOYEE                  → /
 *
 * `/login` is never a destination: an authenticated user who lands there
 * must be routed somewhere that explains their state.
 */
export function getAccountDestination(
  profile: { status?: string | null; role?: string | null } | null | undefined,
): string {
  if (!profile) return "/pending";
  if (profile.status === "SUSPENDED") return "/suspended";
  if (profile.status !== "ACTIVE" || !profile.role) return "/pending";
  return profile.role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
}

/** Display labels for the UI. */
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

/** Short description of what a role can do, for the employees screen. */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: "Full access, including roles, settings and permanent deletion.",
  MANAGER: "Runs day-to-day operations for their own projects.",
  EMPLOYEE: "Works on the tasks assigned to them.",
};