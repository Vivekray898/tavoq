import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Calendar ownership tests.
 *
 * The invariant: a task's calendar event belongs to its assignee and
 * nobody else, so the number of connected accounts can never multiply
 * events for a task.
 *
 * These are static assertions over the sync source rather than live
 * Google API calls, because the property being protected is "which
 * rows can this function reach" — a property of the query, not of any
 * response. A behavioural test would need two connected Google accounts
 * and would still not prove the filter is present.
 */

const SOURCE = readFileSync("lib/actions/google-calendar.ts", "utf8");
const MIGRATION = readFileSync(
  "supabase/migrations/016_calendar_ownership.sql",
  "utf8"
);

/** Strip comments so documentation prose isn't mistaken for code. */
function code(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const SRC = code(SOURCE);
const MIG = code(MIGRATION);

describe("assignee-only calendar ownership", () => {
  it("syncTaskToCalendar filters on assigned_to", () => {
    const body = SRC.slice(SRC.indexOf("export async function syncTaskToCalendar"));
    const fn = body.slice(0, body.indexOf("\n}"));
    assert.match(
      fn,
      /\.eq\(\s*["']assigned_to["']\s*,\s*profile\.id\s*\)/,
      "syncTaskToCalendar must only ever load tasks assigned to the caller"
    );
  });

  it("fullSyncForUser filters on assigned_to", () => {
    const body = SRC.slice(SRC.indexOf("async function fullSyncForUser"));
    const fn = body.slice(0, body.indexOf("\n}"));
    assert.match(
      fn,
      /\.eq\(\s*["']assigned_to["']\s*,\s*userId\s*\)/,
      "fullSyncForUser must only ever push the caller's own tasks"
    );
  });

  it("never loops over other users' token rows when pushing", () => {
    // A fan-out would look like reading several token rows and syncing
    // for each. There must be no such loop in the outbound path.
    const outbound = SRC.slice(
      SRC.indexOf("export async function syncTaskToCalendar")
    );
    assert.equal(
      /\.from\(["']user_google_tokens["']\)[\s\S]{0,400}?\.neq\(/.test(outbound),
      false,
      "outbound sync must not select other users' calendars"
    );
  });

  it("clears google_event_id on reassignment, at the database", () => {
    // Enforced by a trigger rather than in the app, so a bulk update or
    // a direct SQL write cannot leave a stale id behind.
    assert.match(MIG, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.clear_google_event_on_reassign/);
    assert.match(MIG, /NEW\.assigned_to\s+IS\s+DISTINCT\s+FROM\s+OLD\.assigned_to/);
    assert.match(MIG, /NEW\.google_event_id\s*:=\s*NULL/);
    assert.match(
      MIG,
      /BEFORE\s+UPDATE\s+ON\s+public\.tasks/,
      "the trigger must run before the update so the stored id is already null"
    );
  });

  it("performs the one-time stale-id cleanup", () => {
    assert.match(
      MIG,
      /UPDATE\s+public\.tasks[\s\S]*?SET\s+google_event_id\s*=\s*NULL/
    );
    assert.match(MIG, /user_google_tokens/);
  });

  it("adds no service account or shared calendar fan-out", () => {
    // The ownership model is per-user tokens only.
    assert.equal(
      /service[_-]?account/i.test(SRC),
      false,
      "calendar sync must not use a service account"
    );
  });

  it("documents the ownership model", () => {
    const doc = readFileSync("docs/google-calendar.md", "utf8");
    assert.match(doc, /## Why no duplicates/);
    assert.match(doc, /assigned_to/);
  });
});