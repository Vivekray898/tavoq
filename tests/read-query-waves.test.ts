import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Single-wave reads on the detail and list surfaces.
 *
 * Three read paths fetched rows one round-trip at a time even though
 * each read keyed off a function argument rather than off the previous
 * result:
 *
 *   getClient          4 queries / 3 waves -> 2 queries / 2 waves
 *   getClients         2 queries / 2 waves -> 2 queries / 1 wave
 *   getEmployeeProfile 2 queries / 2 waves -> 2 queries / 1 wave
 *
 * getClient also issued two overlapping task reads — one selecting
 * `project_id` for active counts, another selecting
 * `status, deadline, project_id` for stats over the same rows. The
 * second is a strict superset, so the first was a pure duplicate
 * round-trip.
 *
 * Asserted against the source: these actions depend on next/headers and
 * the Supabase server client, which the test runner cannot load.
 */

const CLIENTS = readFileSync("lib/actions/clients.ts", "utf8");
const EMPLOYEES = readFileSync("lib/actions/employees.ts", "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function bodyOf(src: string, name: string): string {
  const code = strip(src);
  // Anchor on the signature, not the bare name: "getClient" is a
  // prefix of "getClients", which is declared first and would
  // otherwise be returned for both.
  const needle = `export async function ${name}(`;
  const start = code.indexOf(needle);
  assert.ok(start > -1, `${name} not found`);
  return code.slice(start, code.indexOf("\n}", start));
}

/** The `Promise.all([...])` statement, including its array. */
function batchSpan(body: string): string {
  const at = body.indexOf("await Promise.all");
  assert.ok(at > -1, "expected a Promise.all batch");
  const end = body.indexOf("]);", at);
  assert.ok(end > at, "unterminated Promise.all");
  return body.slice(at, end);
}

/** Everything after the batch resolves — a second serial wave. */
function afterBatch(body: string): string {
  return body.slice(body.indexOf("]);", body.indexOf("await Promise.all")));
}

const getClient = bodyOf(CLIENTS, "getClient");
const getClients = bodyOf(CLIENTS, "getClients");
const getEmployeeProfile = bodyOf(EMPLOYEES, "getEmployeeProfile");

describe("getClient", () => {
  it("issues three queries, not four", () => {
    // Two in the first wave (clients, projects) plus the one task read
    // that genuinely depends on projectIds.
    assert.equal(
      (getClient.match(/\.from\("/g) ?? []).length,
      3,
      "clients, projects, and exactly one tasks read"
    );
  });

  it("reads the client and its projects concurrently", () => {
    assert.ok(
      batchSpan(getClient).includes("clientPromise") &&
        batchSpan(getClient).includes("projectsPromise"),
      "both reads must be awaited together"
    );
  });

  it("issues only the one dependent query after the first batch", () => {
    // The task read depends on projectIds, so exactly one query may
    // follow the first wave. The original code had two there.
    assert.equal(
      (afterBatch(getClient).match(/\.from\("/g) ?? []).length,
      1,
      "only the task read may follow, and only once"
    );
  });

  it("derives both per-project active counts and task_stats from one read", () => {
    assert.equal((getClient.match(/\.from\("tasks"\)/g) ?? []).length, 1);
    assert.match(getClient, /counts\.set\(/);
    assert.match(getClient, /taskStats\.active \+= 1/);
  });

  it("still counts a completed task as completed, never as active", () => {
    assert.match(getClient, /if \(t\.status === "COMPLETED"\)[\s\S]*?taskStats\.completed \+= 1;[\s\S]*?continue;/);
  });

  it("still requires staff and keeps the not-found branch", () => {
    assert.match(getClient, /requireStaff\(\)/);
    assert.match(getClient, /Employee not found|Client not found/);
  });
});

describe("getClients", () => {
  it("reads the list and the project counts concurrently", () => {
    assert.match(batchSpan(getClients), /projectsPromise/);
  });

  it("constructs no query after the batch resolves", () => {
    assert.equal(afterBatch(getClients).includes(".from("), false);
  });

  it("still surfaces a client-list failure", () => {
    assert.match(getClients, /if \(error\)/);
    assert.match(getClients, /Failed to load clients/);
  });

  it("still scopes the project-count read to non-archived projects", () => {
    assert.match(getClients, /\.neq\("status", "ARCHIVED"\)/);
  });
});

describe("getEmployeeProfile", () => {
  it("reads the profile and the task list concurrently", () => {
    const span = batchSpan(getEmployeeProfile);
    assert.ok(span.includes("employeePromise") && span.includes("tasksPromise"));
  });

  it("constructs no query after the batch resolves", () => {
    assert.equal(afterBatch(getEmployeeProfile).includes(".from("), false);
  });

  it("keeps the not-found branch for a missing employee", () => {
    assert.match(getEmployeeProfile, /if \(error \|\| !employee\)/);
    assert.match(getEmployeeProfile, /Employee not found/);
  });

  it("still requires staff", () => {
    assert.match(getEmployeeProfile, /requireStaff\(\)/);
  });
});