"use client";

import { useSession } from "@/components/providers/session-provider";
import {
  can as canPermission,
  isManager as isManagerRole,
  isStaff as isStaffRole,
  isSuperAdmin as isSuperAdminRole,
  type Permission,
} from "@/lib/permissions";
import type { UserRole } from "@/types/database";

/**
 * Role helpers for client components.
 *
 * Reads the profile the dashboard layout already loaded, so asking
 * "am I a manager?" costs nothing — no extra fetch, no loading state.
 *
 * ── Important ─────────────────────────────────────────────────
 * Every predicate here is COSMETIC. It decides what to show, never
 * what is allowed. Authorization lives in the server actions and RLS
 * (Phase 1), so hiding a button is a courtesy to the user, not a
 * security boundary. A user who forges a request still gets nothing.
 */

export interface RoleContext {
  role: UserRole;
  userId: string;
  isSuperAdmin: boolean;
  isManager: boolean;
  /** SUPER_ADMIN or MANAGER. */
  isStaff: boolean;
  isEmployee: boolean;
  /** Does this role hold this permission? (cosmetic) */
  can: (permission: Permission) => boolean;
}

export function useRole(): RoleContext {
  const { role, userId } = useSession();

  return {
    role,
    userId,
    isSuperAdmin: isSuperAdminRole(role),
    // A super admin can do everything a manager can, so most
    // capability checks should use `can()` rather than `isManager`.
    isManager: isManagerRole(role),
    isStaff: isStaffRole(role),
    isEmployee: role === "EMPLOYEE",
    can: (permission) => canPermission(role, permission),
  };
}