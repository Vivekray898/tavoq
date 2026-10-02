import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration 013 renamed the `ADMIN` enum value to `SUPER_ADMIN` and
 * removed it. Any application code still filtering on `role = 'ADMIN'`
 * is now a runtime error: Postgres rejects the literal as an invalid
 * input value for the enum.
 *
 * This class of bug does NOT fail `tsc`, because the query string is
 * just a string. It only surfaces when that code path runs against a
 * migrated database — which is why it is checked statically here.
 *
 * Two real instances were found this way, in tasks.ts and comments.ts,
 * both in the "notify staff about a submission" path.
 */

const SKIP_DIRS = ["node_modules", ".next", ".git", "supabase", "tests", ".vercel"];
const SCAN_ROOTS = ["lib", "app", "components", "types", "validators"];

/** Files that legitimately mention ADMIN outside the enum. */
const ALLOW = ["lib/permissions.ts"];

/** Patterns that indicate ADMIN used as a QUERY VALUE. */
const PATTERNS: RegExp[] = [
  /\.eq\(\s*["']role["']\s*,\s*["']ADMIN["']/,
  /\.in\(\s*["']role["']\s*,\s*\[[^\]]*["']ADMIN["']/,
  /\brole\s*=\s*["']ADMIN["']/,
  /["']ADMIN["']\s*::\s*user_role/,
];

function collectFiles(): string[] {
  const files: string[] = [];

  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.includes(entry)) continue;
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) visit(full);
      else if (full.endsWith(".ts") || full.endsWith(".tsx")) files.push(full);
    }
  };

  for (const root of SCAN_ROOTS) {
    try {
      visit(root);
    } catch {
      // Root absent in this checkout — nothing to scan.
    }
  }
  return files;
}

describe("retired role literals", () => {
  it("scans a non-trivial number of files", () => {
    // Guards the scan itself: if the walk silently returned nothing the
    // test below would pass vacuously.
    const files = collectFiles();
    assert.ok(
      files.length > 50,
      `expected to scan the source tree, only saw ${files.length} files`
    );
  });

  it("no source file filters on the removed ADMIN role", () => {
    const offenders = collectFiles().filter((file) => {
      if (ALLOW.includes(file)) return false;
      const source = readFileSync(file, "utf8");
      // Strip comments so prose about ADMIN is not flagged.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      return PATTERNS.some((re) => re.test(code));
    });

    assert.deepEqual(
      offenders,
      [],
      `these files still filter on the retired ADMIN role and would throw at runtime:\n  ${offenders.join(
        "\n  "
      )}`
    );
  });

  it("UserRole no longer includes ADMIN", async () => {
    const { USER_ROLES_FOR_TEST } = await import("./fixtures/roles.ts");
    // Compared as string[] because "ADMIN" is deliberately not in the
    // UserRole union — passing it as UserRole would be the very
    // compile error this test guards against.
    const roles: string[] = [...USER_ROLES_FOR_TEST];
    assert.ok(
      !roles.includes("ADMIN"),
      "ADMIN was renamed to SUPER_ADMIN in migration 013"
    );
    assert.deepEqual(roles.sort(), ["EMPLOYEE", "MANAGER", "SUPER_ADMIN"]);
  });
});