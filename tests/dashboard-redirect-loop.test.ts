import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * /admin and /employee must never point at each other.
 *
 * They used to. /admin redirected every non-SUPER_ADMIN to /employee, and
 * /employee redirected every non-EMPLOYEE back to /admin. A manager — who
 * is neither — bounced between the two forever, and Next.js answered with
 * a redirect-limit error instead of a page.
 *
 * Asserted against the source because both pages call requireAuth(), which
 * depends on next/headers and cannot be loaded by the test runner.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const admin = strip(read("../app/(dashboard)/admin/page.tsx"));
const employee = strip(read("../app/(dashboard)/employee/page.tsx"));

/** The literal argument of every redirect() in a page body. */
function redirectTargets(src: string): string[] {
  return [...src.matchAll(/redirect\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("dashboard workspace pages do not redirect to each other", () => {
  test("/admin does not redirect to /employee", () => {
    assert.ok(
      !redirectTargets(admin).includes("/employee"),
      "/admin must not send anyone to /employee — that pair looped for managers"
    );
  });

  test("/employee does not redirect to /admin", () => {
    assert.ok(
      !redirectTargets(employee).includes("/admin"),
      "/employee must not send anyone to /admin — that pair looped for managers"
    );
  });

  test("both pages fall through to / for every non-matching role", () => {
    assert.ok(redirectTargets(admin).includes("/dashboard"));
    assert.ok(redirectTargets(employee).includes("/dashboard"));
  });

  test("no page redirects to itself", () => {
    for (const [name, src, self] of [
      ["admin", admin, "/admin"],
      ["employee", employee, "/employee"],
    ] as const) {
      assert.ok(
        !redirectTargets(src).includes(self),
        `${name} redirects to itself`
      );
    }
  });

  test("no page can produce a cycle for any role", () => {
    // Simulate both gates for each role. A cycle is any repeated visit.
    const graph: Record<string, (role: string) => string | null> = {
      "/admin": (r) => (r === "SUPER_ADMIN" ? null : "/dashboard"),
      "/employee": (r) => (r === "EMPLOYEE" ? null : "/dashboard"),
    };

    for (const role of ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"]) {
      for (const start of Object.keys(graph)) {
        const seen = new Set<string>([start]);
        let cur: string | null = start;
        while (cur && graph[cur]) {
          cur = graph[cur](role);
          if (!cur) break;
          assert.ok(
            !seen.has(cur),
            `${role}: ${start} loops through ${cur}`
          );
          seen.add(cur);
        }
      }
    }
  });
});