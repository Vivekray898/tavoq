import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/types/database";

/**
 * Get the current authenticated user's profile.
 * Returns null if not authenticated.
 */
export async function getUserProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return null;
  }

  return profile as Profile;
}

/**
 * Get the current user ID.
 * Returns null if not authenticated.
 */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

/**
 * Check if the current user is an active admin.
 */
export async function isAdmin(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile?.status === "ACTIVE" && profile.role === "ADMIN";
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
 * Require an ACTIVE ADMIN. Every privileged action funnels through
 * this check — the client's claimed role is never trusted.
 */
export async function requireActiveAdmin(): Promise<Profile> {
  const profile = await requireActiveUser();

  if (profile.role !== "ADMIN") {
    throw new Error("Unauthorized: Admin access required");
  }

  return profile;
}

// ──────────────────────────────────────────────
// Back-compat aliases (existing call sites)
// ──────────────────────────────────────────────

/** @deprecated use requireActiveAdmin */
export const requireAdmin = requireActiveAdmin;

/** @deprecated use requireActiveUser */
export const requireAuth = requireActiveUser;

// ──────────────────────────────────────────────
// Shared access helpers
// ──────────────────────────────────────────────

/**
 * Check if user has access to a project (admin or member).
 */
export async function hasProjectAccess(
  projectId: string,
  userId: string,
  userRole: UserRole | null
): Promise<boolean> {
  if (userRole === "ADMIN") return true;

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
    .select("*")
    .eq("role", "EMPLOYEE")
    .eq("status", "ACTIVE")
    .order("full_name");

  if (error || !data) return [];

  return data as Profile[];
}
