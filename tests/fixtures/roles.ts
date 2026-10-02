import { ROLES } from "../../lib/permissions.ts";

/**
 * The canonical role list, sourced from the module that owns it so a
 * test can never drift from the real model.
 */
export const USER_ROLES_FOR_TEST = ROLES;

/** Convenience aliases for readability in tests. */
export const SUPER_ADMIN = "SUPER_ADMIN" as const;
export const MANAGER = "MANAGER" as const;
export const EMPLOYEE = "EMPLOYEE" as const;