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
 * Check if the current user is an admin.
 */
export async function isAdmin(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile?.role === "ADMIN";
}

/**
 * Check if the current user is an employee.
 */
export async function isEmployee(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile?.role === "EMPLOYEE";
}

/**
 * Require admin role. Throws if not admin.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await getUserProfile();

  if (!profile) {
    throw new Error("Not authenticated");
  }

  if (profile.role !== "ADMIN") {
    throw new Error("Unauthorized: Admin access required");
  }

  return profile;
}

/**
 * Require any authenticated user.
 */
export async function requireAuth(): Promise<Profile> {
  const profile = await getUserProfile();

  if (!profile) {
    throw new Error("Not authenticated");
  }

  return profile;
}

/**
 * Check if user has access to a project (admin or member).
 */
export async function hasProjectAccess(
  projectId: string,
  userId: string,
  userRole: UserRole
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
 * Get all active employees.
 */
export async function getActiveEmployees(): Promise<Profile[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "EMPLOYEE")
    .eq("active", true)
    .order("full_name");

  if (error || !data) return [];

  return data as Profile[];
}
