#!/usr/bin/env node
/**
 * Phase B proof — the admin dashboard is one round-trip.
 *
 * Counts the database round-trips on the dashboard read path from the
 * source, so the claim is checkable in CI rather than asserted in a
 * commit message. Two paths exist by design:
 *
 *   primary  — one RPC call
 *   fallback — the original nine-query implementation, used only when
 *              migration 022 has not been applied
 *
 * The fallback is allowed to contain its nine queries, but it must be
 * unreachable except through the explicit missing-function branch. If
 * someone starts calling the legacy path directly, this fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const src = readFileSync(join(ROOT, "lib", "actions", "dashboard.ts"), "utf8");

let failures = 0;
const fail = (m) => {
  console.error(`  ✖ ${m}`);
  failures++;
};

const entry = src.slice(
  src.indexOf("export async function getAdminDashboard"),
  src.indexOf("async function getAdminDashboardLegacy")
);

// Bound the fallback at the NEXT top-level declaration. Slicing to
// end-of-file swept in the employee dashboard and reported 16 queries
// instead of the real 9, which would have hidden a deletion.
const legacyStart = src.indexOf("async function getAdminDashboardLegacy");
const nextFn = src.slice(legacyStart).search(/\n(?:export\s+)?(?:async\s+)?function\s+\w+/);
const legacy =
  nextFn === -1
    ? src.slice(legacyStart)
    : src.slice(legacyStart, legacyStart + nextFn);

// ── Primary path: exactly one RPC call ─────────────────────────────────
const rpcCalls = (entry.match(/\.rpc\(/g) ?? []).length;
if (rpcCalls !== 1) fail(`primary path should issue exactly 1 .rpc() call, found ${rpcCalls}`);

const tableCalls = (entry.match(/\.from\("[a-z_]+"\)/g) ?? []).length;
if (tableCalls !== 0)
  fail(`primary path should not query tables directly, found ${tableCalls}`);

// ── Fallback is only reachable via the missing-function branch ────────
const hasFallbackBranch = /PGRST202|does not exist/.test(entry);
if (!hasFallbackBranch)
  fail("primary path has no explicit missing-function fallback branch");

const legacyCalls = (legacy.match(/\.from\("[a-z_]+"\)/g) ?? []).length;
if (legacyCalls !== 9)
  fail(
    `fallback should retain the original 9 queries, found ${legacyCalls} — ` +
      `it must be preserved verbatim until migration 022 is applied everywhere`
  );

// The legacy function must not be exported: nothing should call it
// directly and bypass the feature detection.
if (/export\s+async\s+function\s+getAdminDashboardLegacy/.test(src))
  fail("getAdminDashboardLegacy must not be exported");

// ── Authorization happens before the read ─────────────────────────────
const authIdx = entry.indexOf("requireStaff()");
const rpcIdx = entry.indexOf(".rpc(");
if (authIdx === -1 || rpcIdx === -1) fail("could not locate auth and rpc call");
else if (authIdx > rpcIdx)
  fail("authorization must run before the RPC call, not after it");

if (failures) {
  console.error(`  ${failures} dashboard round-trip problem(s)`);
  process.exit(1);
}
console.log(
  `  · dashboard: 1 RPC round-trip (was 9 PostgREST queries); ` +
    `legacy fallback retained (${legacyCalls} queries), unexported`
);