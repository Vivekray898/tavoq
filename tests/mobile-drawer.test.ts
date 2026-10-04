import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { getNavForRole, getNavItemsForRole } from "../lib/navigation.ts";
import type { UserRole } from "../types/database.ts";

/**
 * §71 mobile — the Discord-style drawer that replaced the fixed bottom bar.
 *
 * The role matrix is asserted against getNavForRole rather than by reading
 * the source: a nav config can look correct and still filter the wrong role,
 * and only the resolved output proves what a user will actually see.
 *
 * The file-existence assertions are deliberate. The old bottom bar and FAB
 * were components, not classes, so removing their call sites is not enough —
 * a leftover file that nothing imports is dead weight that will be
 * re-mounted by the next person who greps for "MobileNav".
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const ROLES: UserRole[] = ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"];
const drawerHrefs = (role: UserRole) =>
  getNavForRole(role).mobile.map((i) => i.href);
const sidebarHrefs = (role: UserRole) =>
  getNavForRole(role)
    .desktop.flatMap((s) => s.items)
    .map((i) => i.href);

describe("role matrix", () => {
  const ALL_ROLES = ["/dashboard", "/tasks", "/calendar", "/notifications"];
  const STAFF_ONLY = ["/projects", "/clients", "/employees"];

  test("shared destinations are visible to all three roles", () => {
    for (const role of ROLES) {
      for (const href of ALL_ROLES) {
        assert.ok(sidebarHrefs(role).includes(href), `${role} sidebar ${href}`);
        assert.ok(drawerHrefs(role).includes(href), `${role} drawer ${href}`);
      }
    }
  });

  test("Calendar is visible to every role on both surfaces", () => {
    // The point of the change: employees get their own deadlines too.
    for (const role of ROLES) {
      assert.ok(drawerHrefs(role).includes("/calendar"), `${role} drawer`);
      assert.ok(sidebarHrefs(role).includes("/calendar"), `${role} sidebar`);
    }
  });

  test("Projects, Clients and Team are staff-only", () => {
    for (const role of ROLES) {
      for (const href of STAFF_ONLY) {
        const visible = drawerHrefs(role).includes(href);
        assert.equal(
          visible,
          role !== "EMPLOYEE",
          `${role} should${role === "EMPLOYEE" ? " not" : ""} see ${href}`
        );
      }
    }
  });

  test("Settings is super-admin only", () => {
    assert.equal(drawerHrefs("SUPER_ADMIN").includes("/settings"), true);
    assert.equal(drawerHrefs("MANAGER").includes("/settings"), false);
    assert.equal(drawerHrefs("EMPLOYEE").includes("/settings"), false);
  });

  test("Payments stays visible to employees, who get their own earnings view", () => {
    // /payments branches on role and RLS grants employees their own rows,
    // so hiding the entry would strand a page that works.
    assert.equal(drawerHrefs("EMPLOYEE").includes("/payments"), true);
  });

  test("the drawer and sidebar never disagree about what a role can see", () => {
    // Single source of truth: same items, one grouping pass.
    for (const role of ROLES) {
      const sidebar = new Set(sidebarHrefs(role));
      for (const href of drawerHrefs(role)) {
        if (href === "/profile") continue; // drawer-only identity row
        assert.ok(sidebar.has(href), `${role} drawer has ${href} but sidebar does not`);
      }
    }
  });

  test("an item with no role restriction is visible to everyone", () => {
    // Guards the "omitted roles means all roles" convention.
    for (const item of getNavItemsForRole("SUPER_ADMIN")) {
      if (item.roles) continue;
      for (const role of ROLES) {
        assert.ok(
          drawerHrefs(role).includes(item.href),
          `${item.label} unrestricted but hidden from ${role}`
        );
      }
    }
  });

  test("no role ever gets an empty section", () => {
    for (const role of ROLES) {
      for (const section of getNavForRole(role).desktop) {
        assert.ok(section.items.length > 0, `${role} empty section`);
      }
    }
  });
});

describe("the fixed bottom bar is gone", () => {
  test("mobile-nav.tsx no longer exists", () => {
    assert.equal(
      existsSync(new URL("../components/layout/mobile-nav.tsx", import.meta.url)),
      false,
      "the bottom-bar component must be deleted, not just unmounted"
    );
  });

  test("app-shell renders no bottom nav and no floating action button", () => {
    const src = strip(read("../components/layout/app-shell.tsx"));
    assert.doesNotMatch(src, /MobileNav\b/);
    assert.doesNotMatch(src, /MobileQuickCreate/);
    // The old bar was a fixed, full-width nav pinned to the bottom.
    assert.doesNotMatch(src, /fixed inset-x-0 bottom-0/);
  });

  test("the drawer is mounted in its place", () => {
    const src = strip(read("../components/layout/app-shell.tsx"));
    assert.match(src, /<MobileNavDrawer open=\{navOpen\} onOpenChange=\{setNavOpen\}/);
  });

  test("main no longer reserves pb-24 for a bar that is not there", () => {
    const src = strip(read("../components/layout/app-shell.tsx"));
    assert.doesNotMatch(src, /pb-24/);
    // Still clears the iOS home indicator, so content never sits flush.
    assert.match(src, /env\(safe-area-inset-bottom\)/);
  });

  test("the mobile FAB is deleted from quick-create", () => {
    const src = strip(read("../components/shared/quick-create.tsx"));
    assert.doesNotMatch(src, /MobileQuickCreate/);
    assert.doesNotMatch(src, /fixed bottom-20/);
    // The desktop QuickCreate trigger is untouched.
    assert.match(src, /export function QuickCreate/);
  });
});

describe("the hamburger button", () => {
  test("the mobile header renders one, using lucide Menu", () => {
    const src = strip(read("../components/layout/mobile-header.tsx"));
    assert.match(src, /Menu/);
    assert.match(src, /aria-label="Open navigation menu"/);
    // Below lg only — the desktop sidebar is untouched.
    assert.match(src, /lg:hidden/);
  });

  test("it appears on the dashboard and detail pages too", () => {
    // Those routes return null from MobileHeader by design, so without a
    // separate trigger the drawer would be unreachable on the two most
    // visited screens.
    const src = strip(read("../components/layout/mobile-menu-button.tsx"));
    assert.match(src, /pathname !== "\/dashboard"/);
    assert.match(src, /isDetail/);
    assert.match(src, /lg:hidden/);
  });

  test("both triggers drive the same open state", () => {
    // One source of truth for open/closed — not two competing booleans.
    const src = strip(read("../components/layout/app-shell.tsx"));
    const setters = src.match(/setNavOpen\(true\)/g) ?? [];
    assert.equal(setters.length, 2, "header and floating trigger both open it");
  });
});

describe("the drawer itself", () => {
  const drawer = () => strip(read("../components/layout/mobile-nav-drawer.tsx"));

  test("is a left-anchored Sheet, not a hand-rolled animation", () => {
    const src = drawer();
    assert.match(src, /side="left"/);
    assert.match(src, /<Sheet/);
    assert.doesNotMatch(src, /translate-x-\d/);
  });

  test("is w-72 capped at 85vw", () => {
    const src = drawer();
    // The width utilities must repeat the primitive's data-[side=left]
    // variant. A bare "w-72" loses on CSS specificity to the primitive's
    // `data-[side=left]:w-3/4` and the drawer silently renders at 75%
    // width — so assert the prefix, not just the width.
    assert.match(src, /data-\[side=left\]:w-72/);
    assert.match(src, /data-\[side=left\]:max-w-\[85vw\]/);
    assert.doesNotMatch(
      src,
      /"w-72/,
      "a bare w-72 would lose to the primitive's data-[side=left]:w-3/4"
    );
  });

  test("respects the iOS safe areas top and bottom", () => {
    const src = drawer();
    assert.match(src, /paddingTop: "env\(safe-area-inset-top\)"/);
    assert.match(src, /pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  test("scrolls independently, with a sticky header and a reachable footer", () => {
    const src = drawer();
    // min-h-0 is what allows the body to shrink and scroll inside a flex
    // column; without it the footer is pushed off-screen.
    assert.match(src, /min-h-0[\s\S]*?overflow-y-auto/);
    assert.match(src, /shrink-0/);
  });

  test("closes on selection and on route change", () => {
    const src = drawer();
    assert.match(src, /onClick=\{\(\) => onOpenChange\(false\)\}/);
    const effect = src.slice(
      src.indexOf("useEffect"),
      src.indexOf("function isActive")
    );
    assert.match(effect, /pathname/);
    assert.match(effect, /onOpenChange\(false\)/);
  });

  test("shows the logo, the signed-in user, and a sign-out button", () => {
    const src = drawer();
    assert.match(src, /APP_NAME/);
    assert.match(src, /profile\.full_name/);
    assert.match(src, /ROLE_LABELS\[profile\.role\]/);
    assert.match(src, /SignOutButton/);
  });

  test("offers New task, but only where the page allows creating one", () => {
    // /tasks/new redirects EMPLOYEE back to /tasks, so showing the button
    // to them would point at a bounce.
    const src = drawer();
    assert.match(src, /New task/);
    assert.match(src, /href="\/tasks\/new"/);
    assert.match(src, /isStaff\(role\)/);
  });

  test("reuses the notifications provider — no second subscription", () => {
    const src = drawer();
    assert.match(src, /useNotifications\(\)/);
    assert.match(src, /unreadCount/);
    // A second Realtime channel would double traffic and let the badge
    // disagree with the sidebar's.
    assert.doesNotMatch(src, /createClient\(\)/);
    assert.doesNotMatch(src, /subscribe|channel\(/);
    assert.doesNotMatch(src, /useQuery\(/);
  });
});

describe("the desktop sidebar is untouched", () => {
  test("app-sidebar.tsx is unchanged in structure and classes", () => {
    const src = strip(read("../components/layout/app-sidebar.tsx"));
    assert.match(src, /hidden lg:flex/);
    assert.match(src, /bg-sidebar-accent/);
    assert.match(src, /getNavForRole\(role\)\.desktop/);
    // No drawer or hamburger leaked into the desktop surface.
    assert.doesNotMatch(src, /Drawer|hamburger|Menu/);
  });

  test("the drawer never appears at lg and up", () => {
    // Every trigger is lg:hidden, so the drawer cannot be opened on desktop.
    for (const p of [
      "../components/layout/mobile-header.tsx",
      "../components/layout/mobile-menu-button.tsx",
    ]) {
      assert.match(strip(read(p)), /lg:hidden/, `${p} must hide at lg`);
    }
  });
});