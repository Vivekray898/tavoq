"use server";

import { requireAuth } from "@/lib/auth";
import type { Profile, ActionResponse } from "@/types/database";

/**
 * Fetch the current user's role (lightweight, for client components).
 * Server action → no next/headers import leaks into client bundles.
 */
export async function getMyRole(): Promise<ActionResponse<Pick<Profile, "role">>> {
  try {
    const profile = await requireAuth();
    return { success: true, data: { role: profile.role } };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
