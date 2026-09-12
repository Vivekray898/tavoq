"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import type { ActionResponse, Profile } from "@/types/database";

/**
 * Get all active employees (for dropdowns).
 */
export async function getActiveEmployees(): Promise<ActionResponse<Profile[]>> {
  try {
    await requireAuth();

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("role", "EMPLOYEE")
      .eq("active", true)
      .order("full_name");

    if (error) {
      return { success: false, error: "Failed to load employees" };
    }

    return { success: true, data: data as Profile[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
