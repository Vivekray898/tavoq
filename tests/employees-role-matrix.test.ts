import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canManageProfile, ROLES } from "../lib/permissions.ts";
import { roleLabel } from "../lib/utils.ts";

/**
 * The Employees screen must show the three-role model, and must show
 * exactly the actions the database will accept.
 *
 * The screen previously rendered a binary "Make admin" / "Make employee"
 * toggle, so the middle tier was unreachable from the UI: a super admin
 * could not promote anyone to MANAGER at all. It also had no guard
 * against a viewer acting on their own row.
 *
 * These tests pin the three things that broke:
 *   1. every role is reachable, and labelled for humans
 *   2. each (viewer, target) pair offers only canManageProfile() actions
 *   3. a viewer can never act on their own row
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** Strip comments so documentation cannot satisfy — or trip — an assertion. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const list = strip(read("../components/employees/employees-list.tsx"));

type Role = (typeof ROLES)[number];

describe("roleLabel reads as English, not as an enum", () => {
  test("maps all three roles plus the pending case", () => {
    assert.equal(roleLabel("SUPER_ADMIN"), "Super admin");
    assert.equal(roleLabel("MANAGER"), "Manager");
    assert.equal(roleLabel("EMPLOYEE"), "Employee");
    assert.equal(roleLabel(null), "Pending approval");
    assert.equal(roleLabel(undefined), "Pending approval");
  });

  test("a retired or unknown string degrades to the least-privileged label", () => {
    // Never a silent grant of higher access for an unrecognised value.
    assert.equal(roleLabel("ADMIN" as Role), "Employee");
    assert.equal(roleLabel("ROOT" as Role), "Employee");
  });
});

describe("the three-role model is reachable from the UI", () => {
  test("the row renders roleLabel, not the raw enum", () => {
    assert.match(list, /roleLabel\(member\.role\)/);
    assert.doesNotMatch(
      list,
      /\{member\.role \?\? "No role"\}/,
      "the raw enum value is still leaking into the row subtitle",
    );
  });

  test("no 'Make admin' two-state toggle remains", () => {
    assert.doesNotMatch(list, /Make admin/);
    assert.doesNotMatch(
      list,
      /role === "SUPER_ADMIN" \? "EMPLOYEE" : "SUPER_ADMIN"/,
      "a binary promote/demote cannot reach MANAGER",
    );
  });

  test("the retired 'ADMIN' label appears nowhere in the UI", () => {
    // "Admin" on its own is ambiguous with Manager; the enum value must
    // not leak at all.
    assert.doesNotMatch(list, /["']ADMIN["']/);
  });

  test("every role is offered as an approval option", () => {
    // APPROVE writes status AND role, so each grantable role needs its
    // own button.
    assert.match(list, /\["EMPLOYEE", "MANAGER", "SUPER_ADMIN"\] as const/);
    for (const r of ROLES) {
      assert.ok(
        canManageProfile("SUPER_ADMIN", null, "APPROVE", r),
        `a super admin must be able to approve as ${r}`,
      );
    }
  });

  test("the role dropdown enumerates all three tiers", () => {
    assert.match(list, /const assignableRoles = \(target: TeamMember\): UserRole\[\] =>/);
    assert.match(list, /ROLES\.filter\(\(r\) => r !== target\.role\)/);
    assert.match(list, /Change role/);
  });
});

describe("each (viewer, target) pair offers only permitted actions", () => {
  const can = (viewer: Role, target: Role | null, action: Parameters<typeof canManageProfile>[2], req?: Role) =>
    canManageProfile(viewer, target, action, req ?? null);

  test("super admin gets the full set on every row", () => {
    for (const target of [null, ...ROLES] as Array<Role | null>) {
      assert.ok(can("SUPER_ADMIN", target, "SUSPEND"));
      assert.ok(can("SUPER_ADMIN", target, "APPROVE", "EMPLOYEE"));
      assert.ok(can("SUPER_ADMIN", target, "APPROVE", "MANAGER"));
      assert.ok(can("SUPER_ADMIN", target, "APPROVE", "SUPER_ADMIN"));
      for (const r of ROLES) assert.ok(can("SUPER_ADMIN", target, "ROLE_CHANGED", r));
    }
  });

  test("manager may act on employees and pending signups only", () => {
    assert.ok(can("MANAGER", "EMPLOYEE", "SUSPEND"));
    assert.ok(can("MANAGER", null, "APPROVE", "EMPLOYEE"));
    // A manager may never mint a peer or an owner.
    assert.equal(can("MANAGER", null, "APPROVE", "MANAGER"), false);
    assert.equal(can("MANAGER", null, "APPROVE", "SUPER_ADMIN"), false);
    assert.equal(can("MANAGER", "EMPLOYEE", "ROLE_CHANGED", "MANAGER"), false);
    // ...nor touch a privileged row at all.
    for (const action of ["SUSPEND", "REACTIVATE", "REJECT"] as const) {
      assert.equal(can("MANAGER", "MANAGER", action), false, `manager must not ${action} a manager`);
      assert.equal(can("MANAGER", "SUPER_ADMIN", action), false, `manager must not ${action} a super admin`);
    }
  });

  test("an employee may do nothing to anyone", () => {
    for (const target of [null, ...ROLES] as Array<Role | null>) {
      assert.equal(can("EMPLOYEE", target, "SUSPEND"), false);
      assert.equal(can("EMPLOYEE", target, "APPROVE", "EMPLOYEE"), false);
    }
  });

  test("the component gates every action through canActOn / canChangeRoles", () => {
    assert.match(list, /canActOn\(member\.role, "SUSPEND"\)/);
    assert.match(list, /canActOn\(member\.role, "REACTIVATE"\)/);
    assert.match(list, /canActOn\(member\.role, "APPROVE", r\)/);
    assert.match(list, /canChangeRoles/);
  });
});

describe("a viewer can never act on their own row", () => {
  test("self is identified by id", () => {
    assert.match(list, /const isSelf = \(member: TeamMember\) => member\.id === userId;/);
    assert.match(list, /const \{ role, userId \} = useSession\(\);/);
  });

  test("every mutating control is behind !isSelf", () => {
    for (const control of [
      /!isSelf\(member\) && canActOn\(member\.role, "SUSPEND"\)/,
      /!isSelf\(member\) && canActOn\(member\.role, "REACTIVATE"\)/,
      /!isSelf\(member\) && canChangeRoles && assignableRoles\(member\)\.length > 0/,
    ]) {
      assert.match(list, control);
    }
  });

  test("the row marks the viewer's own entry", () => {
    assert.match(list, /isSelf\(member\) \?/);
  });
});

describe("the invite dialog cannot mint an owner", () => {
  test("SUPER_ADMIN is filtered out of the invite list", () => {
    assert.match(
      list,
      /invitableRoles\(role\)\.filter\(\s*\(r\) => r !== "SUPER_ADMIN"\s*\)/,
      "granting full organization control must be a deliberate act on the member list",
    );
  });

  test("the dropdown renders the filtered list, not invitableRoles", () => {
    assert.match(list, /\{inviteRoles\.map\(\(r\) =>/);
    assert.doesNotMatch(list, /\{invitableRoles\(role\)\.map/);
  });

  test("submission re-checks the role, so stale state cannot slip through", () => {
    assert.match(list, /if \(!inviteRoles\.includes\(inviteRole\)\)/);
  });
});

describe("confirmations state what actually changes", () => {
  test("granting a role explains the capability", () => {
    assert.match(list, /full organization control/);
    assert.match(list, /Managers can approve employees/);
    assert.match(list, /Employees can work on tasks assigned to them/);
  });

  test("suspension preserves history and blocks sign-in", () => {
    assert.match(
      list,
      /Existing work history is preserved\. The user will not be able to sign in\./,
    );
  });

  test("no raw enum reaches the confirmation", () => {
    assert.doesNotMatch(list, /will be \{actionLabel\}d\. Existing/);
  });
});
