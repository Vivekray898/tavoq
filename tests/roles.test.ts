import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  can,
  canChangeTaskStatus,
  canManageProfile,
  canManageProject,
  invitableRoles,
  isProjectScoped,
  isRetiredRole,
  isStaff,
} from "../lib/permissions.ts";

/**
 * Authorization tests for the three-role model (migration 013).
 *
 * These exercise lib/permissions.ts directly. That module is the pure
 * mirror of the RLS predicates, so a failure here means either the
 * action guard or the database policy for that branch is wrong.
 *
 * The database-backed equivalents live in roles.db.test.ts and are
 * skipped unless a Supabase instance is reachable.
 */

const P_MINE = "project-mine";
const P_THEIRS = "project-theirs";
const MINE = [P_MINE];
const NO_PROJECTS: string[] = [];

describe("role predicates", () => {
  it("treats super admin and manager as staff, employee as not", () => {
    assert.equal(isStaff("SUPER_ADMIN"), true);
    assert.equal(isStaff("MANAGER"), true);
    assert.equal(isStaff("EMPLOYEE"), false);
    assert.equal(isStaff(null), false);
  });

  it("recognises the retired ADMIN value and grants it nothing", () => {
    // A row that predates migration 013 must not silently inherit
    // super-admin powers just because the string "ADMIN" sorts near
    // "SUPER_ADMIN".
    assert.equal(isRetiredRole("ADMIN"), true);
    assert.equal(isRetiredRole("SUPER_ADMIN"), false);
    assert.equal(can("ADMIN" as never, "settings.manage"), false);
  });

  it("grants nothing to a null or undefined role", () => {
    assert.equal(can(null, "tasks.create"), false);
    assert.equal(can(undefined, "tasks.updateAny"), false);
  });
});

describe("permissions matrix", () => {
  it("super admin holds every permission", () => {
    const all = [
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
    ] as const;

    for (const permission of all) {
      assert.equal(can("SUPER_ADMIN", permission), true, `${permission}`);
    }
  });

  it("employee holds nothing from the matrix", () => {
    assert.equal(can("EMPLOYEE", "tasks.create"), false);
    assert.equal(can("EMPLOYEE", "payments.viewAll"), false);
    assert.equal(can("EMPLOYEE", "profiles.approve"), false);
  });

  it("keeps destructive and configuration actions super-admin only", () => {
    for (const permission of [
      "tasks.delete",
      "projects.delete",
      "clients.delete",
      "payments.delete",
      "settings.manage",
      "profiles.changeRole",
    ] as const) {
      assert.equal(can("SUPER_ADMIN", permission), true, `SA ${permission}`);
      assert.equal(can("MANAGER", permission), false, `MGR ${permission}`);
    }
  });

  it("lets a manager run day-to-day operations", () => {
    for (const permission of [
      "clients.manage",
      "projects.manage",
      "tasks.create",
      "tasks.assign",
      "payments.manage",
      "payments.markPaid",
      "audit.view",
    ] as const) {
      assert.equal(can("MANAGER", permission, { projectId: P_MINE, memberProjectIds: MINE }), true, permission);
    }
  });
});

describe("manager project scoping", () => {
  it("marks only the delegated permissions as project-scoped", () => {
    assert.equal(isProjectScoped("tasks.create"), true);
    assert.equal(isProjectScoped("projects.members.manage"), true);
    assert.equal(isProjectScoped("payments.manage"), false);
    assert.equal(isProjectScoped("profiles.approve"), false);
  });

  it("allows a manager inside their own project", () => {
    assert.equal(can("MANAGER", "tasks.create", { projectId: P_MINE, memberProjectIds: MINE }), true);
    assert.equal(canManageProject("MANAGER", P_MINE, MINE), true);
  });

  it("refuses a manager outside their projects", () => {
    assert.equal(can("MANAGER", "tasks.create", { projectId: P_THEIRS, memberProjectIds: MINE }), false);
    assert.equal(canManageProject("MANAGER", P_THEIRS, MINE), false);
  });

  it("fails closed when a manager supplies no scope at all", () => {
    // The dangerous failure mode is a caller forgetting the scope
    // argument. It must deny, not grant globally.
    assert.equal(can("MANAGER", "tasks.create"), false);
    assert.equal(can("MANAGER", "tasks.create", { projectId: P_MINE }), false);
    assert.equal(can("MANAGER", "tasks.create", { projectId: P_MINE, memberProjectIds: null }), false);
    assert.equal(can("MANAGER", "tasks.create", { projectId: null, memberProjectIds: MINE }), false);
  });

  it("leaves a super admin unrestricted by membership", () => {
    assert.equal(can("SUPER_ADMIN", "tasks.create", { projectId: P_THEIRS, memberProjectIds: NO_PROJECTS }), true);
    assert.equal(canManageProject("SUPER_ADMIN", P_THEIRS, NO_PROJECTS), true);
  });

  it("does not let an employee pass a project-scoped check", () => {
    assert.equal(can("EMPLOYEE", "tasks.create", { projectId: P_MINE, memberProjectIds: MINE }), false);
    assert.equal(canManageProject("EMPLOYEE", P_MINE, MINE), false);
  });
});

describe("profile management", () => {
  it("lets a super admin change a role", () => {
    assert.equal(canManageProfile("SUPER_ADMIN", "EMPLOYEE", "ROLE_CHANGED", "MANAGER"), true);
  });

  it("refuses a manager changing a role", () => {
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "ROLE_CHANGED", "SUPER_ADMIN"), false);
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "ROLE_CHANGED", "MANAGER"), false);
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "ROLE_CHANGED", "EMPLOYEE"), false);
  });

  it("refuses an employee touching any profile", () => {
    assert.equal(canManageProfile("EMPLOYEE", "EMPLOYEE", "APPROVE", "EMPLOYEE"), false);
    assert.equal(canManageProfile(null, null, "APPROVE", "EMPLOYEE"), false);
  });

  it("lets a manager approve an employee", () => {
    assert.equal(canManageProfile("MANAGER", null, "APPROVE", "EMPLOYEE"), true);
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "APPROVE", "EMPLOYEE"), true);
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "SUSPEND"), true);
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "REACTIVATE"), true);
  });

  it("refuses a manager approving a pending user as anything but EMPLOYEE", () => {
    // This is the escalation path. APPROVE writes profiles.role, so a
    // manager must be clamped on the role being granted, not just on
    // the action name.
    assert.equal(canManageProfile("MANAGER", null, "APPROVE", "MANAGER"), false);
    assert.equal(canManageProfile("MANAGER", null, "APPROVE", "SUPER_ADMIN"), false);
  });

  it("refuses a manager acting on a peer manager or a super admin", () => {
    assert.equal(canManageProfile("MANAGER", "MANAGER", "SUSPEND"), false);
    assert.equal(canManageProfile("MANAGER", "MANAGER", "APPROVE", "EMPLOYEE"), false);
    assert.equal(canManageProfile("MANAGER", "SUPER_ADMIN", "SUSPEND"), false);
    assert.equal(canManageProfile("MANAGER", "SUPER_ADMIN", "REACTIVATE"), false);
  });

  it("lets a super admin act on a manager", () => {
    assert.equal(canManageProfile("SUPER_ADMIN", "MANAGER", "SUSPEND"), true);
    assert.equal(canManageProfile("SUPER_ADMIN", "SUPER_ADMIN", "ROLE_CHANGED", "EMPLOYEE"), true);
  });
});

describe("invitable and assignable roles", () => {
  it("limits a manager to inviting employees", () => {
    assert.deepEqual(invitableRoles("MANAGER"), ["EMPLOYEE"]);
    assert.equal(invitableRoles("MANAGER").includes("MANAGER"), false);
    assert.equal(invitableRoles("MANAGER").includes("SUPER_ADMIN"), false);
  });

  it("gives a super admin the full set", () => {
    assert.deepEqual(invitableRoles("SUPER_ADMIN"), ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"]);
  });

  it("grants a manager only EMPLOYEE, a super admin everything", () => {
    assert.deepEqual(invitableRoles("SUPER_ADMIN"), ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"]);
    assert.deepEqual(invitableRoles("MANAGER"), ["EMPLOYEE"]);
    assert.deepEqual(invitableRoles("EMPLOYEE"), []);
  });

  it("gives an employee nothing", () => {
    assert.deepEqual(invitableRoles("EMPLOYEE"), []);
  });
});

describe("task status transitions", () => {
  const task = { assignedTo: "emp-1", projectId: P_MINE };

  it("lets a super admin move any task", () => {
    assert.equal(canChangeTaskStatus("SUPER_ADMIN", { assignedTo: null, projectId: P_THEIRS }, "sa", []), true);
  });

  it("lets a manager move a task in their own project only", () => {
    assert.equal(canChangeTaskStatus("MANAGER", task, "mgr-1", MINE), true);
    assert.equal(canChangeTaskStatus("MANAGER", { ...task, projectId: P_THEIRS }, "mgr-1", MINE), false);
  });

  it("lets an employee move only their own task", () => {
    assert.equal(canChangeTaskStatus("EMPLOYEE", task, "emp-1", MINE), true);
    assert.equal(canChangeTaskStatus("EMPLOYEE", task, "emp-2", MINE), false);
    assert.equal(canChangeTaskStatus("EMPLOYEE", task, null, MINE), false);
  });
});