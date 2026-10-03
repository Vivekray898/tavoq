import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Dashboard query parallelism.
 *
 * Both dashboards used to read their rows in sequential waves: the
 * employee dashboard awaited its active-task query before starting the
 * completed-task one, and the admin dashboard started its overdue-task
 * query only after the whole first batch had resolved — for a read that
 * depends on nothing but the session client. Each wave is a full
 * PostgREST round-trip, so both dashboards paid for one more than they
 * needed on the critical path of their first screen.
 *
 * Asserted against the source: these actions depend on next/headers and
 * the Supabase server client, which the test runner cannot load. The
 * property pinned here is the shape of the code — that no query is
 * constructed after the batch is awaited — rather than a timing.
 */

const SRC = readFileSync("lib/actions/dashboard.ts", "utf8");
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function bodyOf(name: string): string {
  const start = code.indexOf(`export async function ${name}`);
  assert.ok(start > -1, `${name} not found`);
  return code.slice(start, code.indexOf("\n}", start));
}

const employee = bodyOf("getEmployeeDashboard");

/**
 * The admin dashboard now reads through one RPC (migration 022), so the
 * nine-query shape it used to have lives on in getAdminDashboardLegacy,
 * which runs only when that function is not installed. The properties
 * below — no query issued after the batch resolves, every table in the
 * single batch — still matter for that path, so the assertions are
 * retargeted at it rather than deleted.
 */
function bodyOfLegacy(): string {
  const start = code.indexOf("async function getAdminDashboardLegacy");
  assert.ok(start > -1, "getAdminDashboardLegacy not found");
  return code.slice(start, code.indexOf("\n}", start));
}

const admin = bodyOfLegacy();

/**
 * The batch span: from `await Promise.all([` to the `]);` that closes
 * it. Queries are constructed inside this span, which is the point —
 * they are all in flight before anything is awaited.
 */
function batchSpan(body: string): string {
  const at = body.indexOf("await Promise.all");
  assert.ok(at > -1, "expected the reads to be batched with Promise.all");
  const end = body.indexOf("]);", at);
  assert.ok(end > at, "unterminated Promise.all in the source");
  return body.slice(at, end);
}

/** Everything after the batch has RESOLVED — a second serial wave. */
function afterBatch(body: string): string {
  const end = body.indexOf("]);", body.indexOf("await Promise.all"));
  return body.slice(end);
}

describe("admin dashboard", () => {
  it("constructs no query after awaiting its batch", () => {
    assert.equal(
      afterBatch(admin).includes(".from("),
      false,
      "a .from() after the batch await is a second serial wave"
    );
  });

  it("reads every table it needs inside the single batch", () => {
    const batch = batchSpan(admin);
    for (const table of ["tasks", "payments", "profiles", "task_comments"]) {
      assert.ok(batch.includes(`.from("${table}")`), `${table} must be in the batch`);
    }
  });

  it("issues the overdue-task read before the batch is awaited", () => {
    const issuedAt = admin.indexOf("overdueTasksPromise = supabase");
    const awaitedAt = admin.indexOf("await Promise.all");
    assert.ok(issuedAt > -1, "the overdue read must be issued explicitly");
    assert.ok(
      issuedAt < awaitedAt,
      "the overdue read must be in flight before the batch resolves"
    );
    assert.ok(
      batchSpan(admin).includes("overdueTasksPromise"),
      "the overdue read must be awaited as part of the same batch"
    );
  });

  it("still awaits the overdue result rather than dropping it", () => {
    assert.match(admin, /overdueTasksRes\.data/);
  });
});

describe("employee dashboard", () => {
  it("constructs no query after awaiting its batch", () => {
    assert.equal(afterBatch(employee).includes(".from("), false);
  });

  it("batches both task reads", () => {
    assert.match(employee, /Promise\.all\(\[\s*activeTasksPromise,\s*completedTasksPromise/);
  });

  it("still surfaces the active-task read failure", () => {
    // Parallelising must not swallow the error branch that the serial
    // version returned early on.
    assert.match(employee, /if \(error\)/);
    assert.match(employee, /Failed to load your tasks/);
  });
});

describe("staff gate (unchanged by the parallelisation)", () => {
  it("still requires staff before returning admin data", () => {
    // requireStaff moved into the exported entry point when the RPC was
    // introduced; it must still run before any row is read.
    const entry = bodyOf("getAdminDashboard");
    assert.match(entry, /requireStaff\(\)/);
    assert.match(entry, /if \(!authorized\)/);
  });

  it("still re-checks authorization before returning", () => {
    assert.match(admin, /authorizedAgain/);
    assert.match(admin, /if \(!authorizedAgain\)/);
  });

  it("still refuses on the employee dashboard too", () => {
    assert.match(employee, /requireAuth\(\)/);
  });
});