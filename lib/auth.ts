import { createClient } from "@/lib/supabase/server";
import { cache } from "react";
import { canManageProject as canManageProjectRule } from "@/lib/permissions";
import type { Profile, UserRole } from "@/types/database";

/**
 * The columns every server-side identity gate needs from `profiles`.
 * Narrow on purpose: auth.ts runs on the critical path of every page
 * and server action, and `select *` on this table drags avatar/email/
 * preference columns across the wire for no reason.
 */
const PROFILE_COLUMNS = [
  "id",
  "full_name",
  "email",
  "avatar_url",
  "role",
  "status",
  "phone",
  "active",
  "approved_at",
  "approved_by",
  "created_at",
  "updated_at",
].join(", ");

/**
 * The columns the dashboard layout and session context actually consume
 * at bootstrap (greeting, avatar, notification preferences). Narrow on
 * purpose: this read sits on the render path of every first load, and
 * `select *` also drags the PostgREST schema cache into the response.
 */
const SESSION_PROFILE_COLUMNS = [
  "id",
  "full_name",
  "email",
  "avatar_url",
  "role",
  "status",
  "updated_at",
].join(", ");

/**
 * Verify the request's JWT locally (ES256 asymmetric keys — no auth
 * server round-trip) and load the profile. Cached per request: the
 * dashboard layout, the page below it, and every server action fired
 * during first load share ONE verification + ONE profiles read.
 */
export const getUserProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  // getClaims() is the fast path (local ES256 verification, no network).
  // getUser() stays as the fallback so auth still works if the project
  // ever switches back to symmetric JWT signing keys.
  if (claimsError || !claimsData) {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", user.id)
      .single();
    if (profileError || !profile) return null;
    return profile as unknown as Profile;
  }

  const userId = (claimsData.claims.sub as string) ?? null;
  if (!userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(SESSION_PROFILE_COLUMNS)
    .eq("id", userId)
    .single();

  if (profileError || !profile) return null;
  return profile as unknown as Profile;
});

/**
 * The signed-in user's ID, or null when there is no session.
 *
 * Deliberately reads ONLY the session — never `profiles`. This is the
 * signal that separates "you are not signed in" (the only state that
 * belongs on /login) from "you are signed in but your profile row is
 * unreadable". Collapsing those two into one /login redirect is what
 * produced the post-OAuth redirect loop: the user was already signed in,
 * so /login re-offered "Continue with Google", the callback failed for
 * the same reason, and the pair bounced forever.
 */
export async function getSessionUserId(): Promise<string | null> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (!claimsError && claimsData?.claims?.sub) {
    return claimsData.claims.sub as string;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;
  return user.id;
}

/**
 * Get the current user ID.
 * Returns null if not authenticated.
 */
export async function getUserId(): Promise<string | null> {
  const profile = await getUserProfile();
  return profile?.id ?? null;
}

/**
 * Check if the current user is an active super admin.
 */
export async function isAdmin(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile?.status === "ACTIVE" && profile.role === "SUPER_ADMIN";
}

/**
 * Check if the current user is an active manager (exactly MANAGER,
 * not super admin).
 */
export async function isManager(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile?.status === "ACTIVE" && profile.role === "MANAGER";
}

/**
 * Check if the current user is operational staff: an active super
 * admin or an active manager.
 */
export async function isStaffMember(): Promise<boolean> {
  const profile = await getUserProfile();
  return (
    profile?.status === "ACTIVE" &&
    (profile.role === "SUPER_ADMIN" || profile.role === "MANAGER")
  );
}

/**
 * Check if the current user is an active employee.
 */
export async function isEmployee(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile?.status === "ACTIVE" && profile.role === "EMPLOYEE";
}

/**
 * Require any authenticated profile (including pending/suspended).
 * Use only for flows that must work for those states (e.g. the
 * pending page itself).
 */
export async function requireAuthenticatedProfile(): Promise<Profile> {
  const profile = await getUserProfile();

  if (!profile) {
    throw new Error("Not authenticated");
  }

  return profile;
}

/**
 * Require an ACTIVE SUPER ADMIN.
 *
 * @deprecated Superseded by the three-role model (migration 013).
 * Kept for one release so existing call sites keep compiling, but it
 * now resolves to super admin only — the old meaning ("any admin")
 * is exactly the distinction the new role model introduces, so code
 * that still says requireAdmin() is ambiguous and must be migrated to
 * either requireSuperAdmin() or requireStaff() deliberately.
 */
export const requireAdmin = requireSuperAdmin;

/** @deprecated use requireSuperAdmin */
export const requireActiveAdmin = requireSuperAdmin;

/** @deprecated use requireStaff */
export const requireActiveManager = requireStaff;

/** @deprecated use requireStaff */
export const requireActiveStaff = requireStaff;

/**
 * §57 — require an ACTIVE account with a role (admin or employee).
 * This is the baseline for every application action. Pending and
 * suspended users never pass this check.
 */
export async function requireActiveUser(): Promise<Profile> {
  const profile = await requireAuthenticatedProfile();

  if (profile.status !== "ACTIVE" || !profile.role) {
    throw new Error(
      profile.status === "PENDING"
        ? "Your account is waiting for approval"
        : profile.status === "SUSPENDED"
          ? "Your account is suspended"
          : "Account is not active"
    );
  }

  return profile;
}

/**
 * Require an ACTIVE EMPLOYEE.
 */
export async function requireActiveEmployee(): Promise<Profile> {
  const profile = await requireActiveUser();

  if (profile.role !== "EMPLOYEE") {
    throw new Error("Unauthorized: Employee access required");
  }

  return profile;
}

/**
 * Require an ACTIVE SUPER ADMIN.
 *
 * The configuration and destructive gate: role changes, settings,
 * hard deletes, audit-log writes. A MANAGER is explicitly refused.
 */
export async function requireSuperAdmin(): Promise<Profile> {
  const profile = await requireActiveUser();

  if (profile.role !== "SUPER_ADMIN") {
    throw new Error("Unauthorized: Super admin access required");
  }

  return profile;
}

/**
 * Require an ACTIVE MANAGER or SUPER ADMIN — the operational gate.
 *
 * This is the guard that replaced `requireAdmin()` on day-to-day
 * actions (tasks, projects, clients, payments, invitations, employee
 * approvals). It does NOT grant any power on its own: a manager still
 * has to pass the project-membership check via
 * {@link assertCanManageProject} before mutating anything inside a
 * project. That split is deliberate — the guard answers "is this
 * person staff?", the scope check answers "is this their project?".
 */
export async function requireStaff(): Promise<Profile> {
  const profile = await requireActiveUser();

  if (profile.role !== "SUPER_ADMIN" && profile.role !== "MANAGER") {
    throw new Error("Unauthorized: Manager or super admin access required");
  }

  return profile;
}

/**
 * Require an ACTIVE MANAGER or SUPER ADMIN.
 *
 * Identical to {@link requireStaff}. Kept as a separate name because
 * "staff" is the coarse gate while "manager" reads better at call
 * sites that are specifically about delegated management. Prefer
 * requireStaff(); this exists so both readings are available.
 */
export async function requireManager(): Promise<Profile> {
  return requireStaff();
}

// ──────────────────────────────────────────────
// Back-compat aliases (existing call sites)
// ──────────────────────────────────────────────

/** @deprecated use requireActiveUser */
export const requireAuth = requireActiveUser;

// ──────────────────────────────────────────────
// Project scoping
// ──────────────────────────────────────────────

/**
 * Every project the given user is a member of.
 * One round trip; callers pass the result straight into the scope
 * check so a manager's reach is always derived from real membership
 * rather than from a role flag.
 */
export async function getMemberProjectIds(
  userId: string
): Promise<string[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId);

  return (data ?? []).map((row) => row.project_id as string);
}

/**
 * Assert the current staff member may administer `projectId`.
 *
 * Super admins always pass. Managers pass only for projects they are
 * a member of — this is what makes their operational power scoped
 * rather than global, and it mirrors public.can_manage_project()
 * in migration 013.
 *
 * Throws with a caller-facing message; server actions catch it and
 * return ActionResponse.error.
 */
export async function assertCanManageProject(projectId: string): Promise<void> {
  const profile = await requireStaff();

  if (profile.role === "SUPER_ADMIN") return;

  const memberProjectIds = await getMemberProjectIds(profile.id);

  if (!canManageProjectRule(profile.role, projectId, memberProjectIds)) {
    throw new Error("Unauthorized: you can only manage your own projects");
  }
}

// ──────────────────────────────────────────────
// Shared access helpers
// ──────────────────────────────────────────────

/**
 * Check if user has access to a project (super admin, or a member).
 */
export async function hasProjectAccess(
  projectId: string,
  userId: string,
  userRole: UserRole | null
): Promise<boolean> {
  if (userRole === "SUPER_ADMIN") return true;

  const supabase = await createClient();

  const { data } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/**
 * Get all ACTIVE employees (for assignment dropdowns).
 * Pending and suspended users are never assignable.
 */
export async function getActiveEmployees(): Promise<Profile[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("role", "EMPLOYEE")
    .eq("status", "ACTIVE")
    .order("full_name");

  if (error || !data) return [];

  return data as unknown as Profile[];
}
