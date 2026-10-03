import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAccountDestination } from "../lib/permissions.ts";

/**
 * Regression cover for the post-OAuth redirect loop.
 *
 * The loop had one reachable cause once the data was healthy: /login was
 * a client component that rendered "Continue with Google"
 * unconditionally and discarded the callback's `?error=`. A signed-in
 * user who landed there (the dashboard layout sends a null profile to
 * /login, and the callback sends one on exchange failure) saw a
 * byte-identical screen, clicked again, and failed again — forever.
 *
 * These tests pin the routing table executably and the two source-level
 * rules that close it.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** Strip comments so assertions cannot be satisfied by prose. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("getAccountDestination — the post-sign-in routing table", () => {
  test("ACTIVE super admin lands on the admin workspace", () => {
    assert.equal(
      getAccountDestination({ status: "ACTIVE", role: "SUPER_ADMIN" }),
      "/admin",
    );
  });

  test("ACTIVE manager and employee land on the workspace root", () => {
    assert.equal(getAccountDestination({ status: "ACTIVE", role: "MANAGER" }), "/");
    assert.equal(getAccountDestination({ status: "ACTIVE", role: "EMPLOYEE" }), "/");
  });

  test("PENDING lands on /pending, never on /login", () => {
    const dest = getAccountDestination({ status: "PENDING", role: "EMPLOYEE" });
    assert.equal(dest, "/pending");
    assert.notEqual(dest, "/login");
  });

  test("SUSPENDED lands on /suspended, never on /login", () => {
    const dest = getAccountDestination({ status: "SUSPENDED", role: "EMPLOYEE" });
    assert.equal(dest, "/suspended");
    assert.notEqual(dest, "/login");
  });

  test("a half-migrated row (null role, or no profile at all) still resolves", () => {
    // The exact shape a partially-applied enum migration produces.
    assert.equal(getAccountDestination({ status: "ACTIVE", role: null }), "/pending");
    assert.equal(getAccountDestination(null), "/pending");
    assert.equal(getAccountDestination(undefined), "/pending");
  });

  test("no account state anywhere in the table routes to /login", () => {
    const statuses = ["PENDING", "ACTIVE", "SUSPENDED", null, undefined];
    const roles = ["SUPER_ADMIN", "MANAGER", "EMPLOYEE", null, undefined];
    for (const status of statuses) {
      for (const role of roles) {
        const dest = getAccountDestination({ status, role });
        assert.notEqual(
          dest,
          "/login",
          `status=${status} role=${role} routed back to /login — that is the loop`,
        );
      }
    }
    assert.notEqual(getAccountDestination(null), "/login");
  });

  test("every destination is a real page in this app", () => {
    const pages = [
      "app/(dashboard)/page.tsx",
      "app/(dashboard)/admin/page.tsx",
      "app/(auth)/pending/page.tsx",
      "app/(auth)/suspended/page.tsx",
    ];
    for (const p of pages) {
      // exists, and is non-trivial enough to be a real page
      assert.ok(strip(read(`../${p}`)).trim().length > 40, `${p} looks empty`);
    }
  });
});

describe("/login can never re-offer sign-in to a signed-in user", () => {
  const login = strip(read("../app/(auth)/login/page.tsx"));

  test("resolves the session before rendering the sign-in button", () => {
    const sessionAt = login.indexOf("getSessionUserId(");
    const buttonAt = login.indexOf("<GoogleSignInButton");
    assert.ok(sessionAt > -1, "login page must read the session");
    assert.ok(buttonAt > -1, "login page must still render the sign-in button");
    assert.ok(
      sessionAt < buttonAt,
      "the session must be resolved before the sign-in button is rendered",
    );
  });

  test("guards the button behind the no-session branch", () => {
    // Every path that renders <GoogleSignInButton/> must be preceded by a
    // redirect() or a return, i.e. it is only reachable with no session.
    assert.match(
      login,
      /if\s*\(userId\)\s*\{[\s\S]*?redirect\(\s*getAccountDestination\(profile\)\s*\)[\s\S]*?\}\s*return\s*\(/,
      "a signed-in user must be routed away (or given the diagnostic) before the sign-in screen is returned",
    );
  });

  test("routes a signed-in user through the shared table, not a bare if (session)", () => {
    assert.match(login, /redirect\(\s*getAccountDestination\(profile\)\s*\)/);
    assert.doesNotMatch(
      login,
      /if\s*\(\s*session\s*\)\s*redirect\(/,
      "a bare `if (session) redirect('/')` is the loop's other half",
    );
  });

  test("renders a diagnostic when signed in but the profile is unreadable", () => {
    assert.match(login, /if\s*\(!profile\)\s*\{/);
    // The diagnostic must not be another redirect, and must offer a way out.
    const diagnostic = login.slice(login.indexOf("if (!profile)"));
    const branchEnd = diagnostic.indexOf("redirect(getAccountDestination");
    const branch = diagnostic.slice(0, branchEnd > -1 ? branchEnd : undefined);
    assert.doesNotMatch(branch, /redirect\(/, "the diagnostic must not bounce again");
    assert.match(branch, /SignOutButton/);
    assert.match(branch, /profile/i);
  });

  test("surfaces the callback's ?error instead of discarding it", () => {
    assert.match(login, /searchParams/);
    assert.match(login, /\{error\}/);
    assert.match(login, /role="alert"/);
  });

  test("is a Server Component, so routing happens before any render", () => {
    const raw = read("../app/(auth)/login/page.tsx");
    assert.doesNotMatch(raw, /^\s*"use client"/m, "login must not be a client component");
    assert.doesNotMatch(raw, /^\s*"use server"/m);
  });
});

describe("the OAuth callback and /login share one routing table", () => {
  const callback = strip(read("../app/(auth)/auth/callback/route.ts"));

  test("callback routes via getAccountDestination, not its own if/else chain", () => {
    assert.match(callback, /getAccountDestination\(/);
    assert.doesNotMatch(
      callback,
      /profile\.status === "SUPER_ADMIN"/,
      "the callback must not carry a second copy of the routing rules",
    );
    assert.doesNotMatch(callback, /profile\.role === "SUPER_ADMIN"/);
  });

  test("callback only ever targets /login on a genuine OAuth failure", () => {
    // /login is correct for "exchange failed" and for "no code". It must
    // not be reachable from the success branch.
    const successAt = callback.indexOf("getAccountDestination(");
    const loginUses = [...callback.matchAll(/\/login/g)].map((m) => m.index ?? -1);
    assert.ok(successAt > -1);
    for (const at of loginUses) {
      assert.ok(
        at > successAt,
        "a /login redirect appears before the success branch — an authenticated user could reach it",
      );
    }
  });
});

describe("the dashboard layout states each failure separately", () => {
  const layout = strip(read("../app/(dashboard)/layout.tsx"));

  test("no longer swallows the guard error into a single /login branch", () => {
    assert.doesNotMatch(
      layout,
      /\.catch\(\(\)\s*=>\s*null\)/,
      "collapsing 'no session' and 'profile unreadable' into one null is what fed the loop",
    );
  });

  test("suspended goes to /suspended and non-active goes to /pending", () => {
    assert.match(layout, /status === "SUSPENDED"\)\s*redirect\("\/suspended"\)/);
    assert.match(layout, /status !== "ACTIVE"[\s\S]*?redirect\("\/pending"\)/);
  });

  test("the layout resolves the profile directly", () => {
    assert.match(layout, /getUserProfile\(\)/);
  });
});

describe("lib/auth.ts exposes the session signal the loop fix depends on", () => {
  const auth = strip(read("../lib/auth.ts"));

  test("getSessionUserId exists and reads the session without a profile", () => {
    assert.match(auth, /export async function getSessionUserId\(/);
    const body = auth.slice(auth.indexOf("export async function getSessionUserId("));
    const end = body.indexOf("\n}\n");
    const fn = body.slice(0, end);
    assert.match(fn, /getClaims\(/);
    assert.match(fn, /getUser\(/);
    assert.doesNotMatch(
      fn,
      /from\("profiles"\)/,
      "getSessionUserId must not read profiles — that is what getUserProfile is for",
    );
  });

  test("the guards still throw rather than redirect", () => {
    // Guards must stay throw-based: a throw is not a redirect, so it can
    // never put an authenticated user back on /login.
    assert.match(auth, /requireActiveUser[\s\S]*?throw new Error\(/);
    assert.match(auth, /requireSuperAdmin[\s\S]*?throw new Error\(/);
    assert.match(auth, /requireStaff[\s\S]*?throw new Error\(/);
    assert.doesNotMatch(auth, /export async function require\w+\([^)]*\)[^{]*\{[^}]*redirect\(/);
  });

  test("requireAuth is still requireActiveUser, and still gates on ACTIVE", () => {
    assert.match(auth, /export const requireAuth = requireActiveUser;/);
    assert.match(auth, /profile\.status !== "ACTIVE"/);
  });
});
