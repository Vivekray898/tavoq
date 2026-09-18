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

/**
 * Fetch the caller's full profile. RLS-scoped to the calling user —
 * no id parameter to abuse. Used by the profile memo cache.
 */
export async function getMyProfile(): Promise<ActionResponse<Profile>> {
  try {
    const profile = await requireAuth();
    return { success: true, data: profile };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
