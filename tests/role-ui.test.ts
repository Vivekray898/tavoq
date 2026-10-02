import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getNavForRole } from "../lib/navigation.ts";
import {
  can,
  canManageProfile,
  invitableRoles,
  isStaff,
} from "../lib/permissions.ts";
import type { UserRole } from "../types/database.ts";

/**
 * Role-aware UI tests.
 *
 * These assert the *navigation and control visibility* rules for the
 * three-role model. They are the JS-level counterpart to the guards
 * already enforced server-side in Phase 1 — a control that is hidden
 * here is still refused by the action if forged, and vice versa.
 *
 * Rendering the real components would need a DOM plus a React test
 * renderer, neither of which this project has. Asserting the
 * navigation structure and the permission predicates that drive the
 * components covers the same rules without adding dependencies; the
 * components consume exactly these functions.
 */

/** Every href in a nav structure. */
function hrefs(role: UserRole): string[] {
  const { desktop, more } = getNavForRole(role);
  return [...desktop.flatMap((s) => s.items), ...more].map((i) => i.href);
}

describe("navigation by role", () => {
  it("hides Settings from a manager", () => {
    assert.equal(hrefs("MANAGER").includes("/settings"), false);
  });

  it("shows Settings to a super admin", () => {
    assert.equal(hrefs("SUPER_ADMIN").includes("/settings"), true);
  });

  it("hides Settings from an employee", () => {
    assert.equal(hrefs("EMPLOYEE").includes("/settings"), false);
  });

  it("shows Team to both staff roles", () => {
    assert.equal(hrefs("MANAGER").includes("/employees"), true);
    assert.equal(hrefs("SUPER_ADMIN").includes("/employees"), true);
  });

  it("hides Team from an employee", () => {
    assert.equal(hrefs("EMPLOYEE").includes("/employees"), false);
  });

  it("shows Payments to staff; an employee gets their own view", () => {
    // Both roles reach /payments, but the page renders a different
    // component per role — the admin workspace vs personal earnings.
    assert.equal(hrefs("MANAGER").includes("/payments"), true);
    assert.equal(hrefs("SUPER_ADMIN").includes("/payments"), true);
    assert.equal(hrefs("EMPLOYEE").includes("/payments"), true);
  });

  it("shows Clients and Projects to managers", () => {
    assert.equal(hrefs("MANAGER").includes("/clients"), true);
    assert.equal(hrefs("MANAGER").includes("/projects"), true);
  });

  it("shows Tasks and Notifications to everyone", () => {
    for (const role of ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as UserRole[]) {
      const h = hrefs(role);
      assert.equal(h.includes("/tasks"), true, `${role} /tasks`);
      assert.equal(h.includes("/notifications"), true, `${role} /notifications`);
    }
  });

  it("does not leak admin destinations to an employee", () => {
    const h = hrefs("EMPLOYEE");
    for (const forbidden of ["/settings", "/employees", "/clients"]) {
      assert.equal(h.includes(forbidden), false, `employee must not see ${forbidden}`);
    }
  });

  it("never emits an empty nav section", () => {
    for (const role of ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as UserRole[]) {
      for (const section of getNavForRole(role).desktop) {
        assert.ok(section.items.length > 0, `${role} has an empty section`);
      }
    }
  });
});

describe("employees screen controls", () => {
  it("offers a manager approve/reject but no privileged role grant", () => {
    // A pending user has role null; approving as EMPLOYEE is allowed.
    assert.equal(canManageProfile("MANAGER", null, "APPROVE", "EMPLOYEE"), true);
    // Approving them as anything else is not.
    assert.equal(canManageProfile("MANAGER", null, "APPROVE", "MANAGER"), false);
    assert.equal(canManageProfile("MANAGER", null, "APPROVE", "SUPER_ADMIN"), false);
  });

  it("offers a super admin the privileged approval", () => {
    assert.equal(
      canManageProfile("SUPER_ADMIN", null, "APPROVE", "SUPER_ADMIN"),
      true
    );
  });

  it("shows role-change controls only to a super admin", () => {
    assert.equal(can("SUPER_ADMIN", "profiles.changeRole"), true);
    assert.equal(can("MANAGER", "profiles.changeRole"), false);
    assert.equal(can("EMPLOYEE", "profiles.changeRole"), false);
  });

  it("hides every action on a manager's row from another manager", () => {
    for (const action of ["APPROVE", "REJECT", "SUSPEND", "REACTIVATE"] as const) {
      assert.equal(
        canManageProfile("MANAGER", "MANAGER", action, "EMPLOYEE"),
        false,
        action
      );
    }
  });

  it("hides every action on a super admin's row from a manager", () => {
    assert.equal(canManageProfile("MANAGER", "SUPER_ADMIN", "SUSPEND"), false);
    assert.equal(canManageProfile("MANAGER", "SUPER_ADMIN", "REACTIVATE"), false);
  });

  it("lets a super admin act on a manager", () => {
    assert.equal(canManageProfile("SUPER_ADMIN", "MANAGER", "SUSPEND"), true);
  });

  it("lets both staff roles suspend and reactivate employees", () => {
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "SUSPEND"), true);
    assert.equal(canManageProfile("MANAGER", "EMPLOYEE", "REACTIVATE"), true);
  });

  it("limits the invite role dropdown per role", () => {
    assert.deepEqual(invitableRoles("MANAGER"), ["EMPLOYEE"]);
    assert.deepEqual(invitableRoles("SUPER_ADMIN"), [
      "SUPER_ADMIN",
      "MANAGER",
      "EMPLOYEE",
    ]);
    assert.deepEqual(invitableRoles("EMPLOYEE"), []);
  });
});

describe("payments screen controls", () => {
  it("lets both staff roles manage payments", () => {
    assert.equal(can("MANAGER", "payments.manage"), true);
    assert.equal(can("SUPER_ADMIN", "payments.manage"), true);
  });

  it("reserves deletion to a super admin", () => {
    assert.equal(can("SUPER_ADMIN", "payments.delete"), true);
    assert.equal(can("MANAGER", "payments.delete"), false);
  });

  it("reserves settings to a super admin", () => {
    assert.equal(can("SUPER_ADMIN", "settings.manage"), true);
    assert.equal(can("MANAGER", "settings.manage"), false);
    assert.equal(can("EMPLOYEE", "settings.manage"), false);
  });

  it("shows an employee only their own payments", () => {
    assert.equal(can("EMPLOYEE", "payments.viewAll"), false);
    assert.equal(can("MANAGER", "payments.viewAll"), true);
  });
});

describe("nav visibility agrees with the server guards", () => {
  /**
   * The nav is cosmetic. What matters is that it never shows a link the
   * server would refuse, and never hides one it would allow for the
   * role in question. This pairs each nav decision with the predicate
   * the page guard uses.
   */
  it("Settings nav entry matches the settings.manage permission", () => {
    for (const role of ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as UserRole[]) {
      assert.equal(
        hrefs(role).includes("/settings"),
        can(role, "settings.manage"),
        `${role}: nav and permission disagree about /settings`
      );
    }
  });

  it("Team nav entry matches staff status", () => {
    for (const role of ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as UserRole[]) {
      assert.equal(
        hrefs(role).includes("/employees"),
        isStaff(role),
        `${role}: nav and staff check disagree about /employees`
      );
    }
  });
});