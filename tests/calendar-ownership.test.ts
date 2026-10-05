import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Calendar ownership tests.
 *
 * The invariant, which has two halves:
 *
 *   • An employee's calendar holds ONLY work assigned to them.
 *   • A SUPER_ADMIN's calendar holds the work they assigned — they are
 *     usually not the assignee, so `assigned_to` alone would give them
 *     an empty calendar and a sync that reports a clean zero forever.
 *
 * What must NOT happen either way: one user reaching into another's
 * token, or two calendars fighting over a single shared event id.
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
const MODE_MIGRATION = readFileSync(
  "supabase/migrations/028_calendar_sync_modes.sql",
  "utf8"
);

/** Strip comments so documentation prose isn't mistaken for code. */
function code(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const SRC = code(SOURCE);
const MIG = code(MIGRATION);
const MODE_MIG = code(MODE_MIGRATION);

describe("calendar ownership: personal vs admin-assigned", () => {
  it("syncTaskToCalendar filters by the caller's own mode column", () => {
    const body = SRC.slice(SRC.indexOf("export async function syncTaskToCalendar"));
    const fn = body.slice(0, body.indexOf("\n}"));
    assert.match(
      fn,
      /\.eq\(\s*mode\s*===\s*"admin_assignment"\s*\?\s*"created_by"\s*:\s*"assigned_to"\s*,\s*profile\.id\s*\)/,
      "syncTaskToCalendar must scope by the mode's own column, keyed to the caller"
    );
  });

  it("fullSyncForUser delegates selection to one shared function", () => {
    const body = SRC.slice(SRC.indexOf("async function fullSyncForUser"));
    const fn = body.slice(0, body.indexOf("\n}"));
    assert.match(
      fn,
      /getTasksForCalendarSync\(userId,\s*mode\)/,
      "the full sync must use the single shared selector"
    );
  });

  it("the one selector chooses assigned_to for personal, created_by for admin", () => {
    const start = SRC.indexOf("async function getTasksForCalendarSync");
    assert.ok(start > -1, "getTasksForCalendarSync not found");
    const fn = SRC.slice(start, SRC.indexOf("\n}", start));
    assert.match(
      fn,
      /\.eq\(\s*mode\s*===\s*"admin_assignment"\s*\?\s*"created_by"\s*:\s*"assigned_to"\s*,\s*userId\s*\)/,
      "the selector is the ONLY place that decides which column filters a sync"
    );
  });

  it("an employee can never reach another employee's tasks", () => {
    // Personal mode must key on assigned_to. A query that read every task,
    // or one that used created_by for an employee, would leak.
    assert.match(
      SRC,
      /mode\s*===\s*"admin_assignment"\s*\?\s*"created_by"\s*:\s*"assigned_to"/,
      "personal mode must resolve to assigned_to"
    );
  });

  it("the mode comes from the caller's ROLE, not from the client", () => {
    // If the request could choose the mode, any user could ask for another
    // user's task set.
    assert.match(
      SRC,
      /syncAllTasksToCalendar[\s\S]{0,900}?calendarSyncModeForRole\(profile\.role\)/,
      "the entry point must derive the mode from the authenticated role"
    );
    assert.match(
      SRC,
      /function calendarSyncModeForRole[\s\S]{0,300}?isSuperAdmin\(role\)\s*\?\s*"admin_assignment"\s*:\s*"personal"/,
      "SUPER_ADMIN maps to admin_assignment; everyone else to personal"
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

  it("resolves a user's event through the per-user mapping, not the task column", () => {
    // tasks.google_event_id is global to the task. Once the same task is
    // on two calendars it holds whichever id was written last, so reading
    // it would make one user PUT or DELETE the other user's event.
    const full = SRC.slice(SRC.indexOf("async function fullSyncForUser"));
    assert.match(
      full,
      /from\(\s*"calendar_events"\s*\)[\s\S]{0,300}?\.eq\("user_id",\s*userId\)/,
      "the event id must be read from calendar_events scoped to this user"
    );
    assert.match(
      full,
      /mode\s*===\s*"personal"\s*\?\s*task\.google_event_id\s*:\s*null/,
      "the legacy task-global column may only be a personal-mode fallback"
    );
  });

  it("only writes the legacy task column in personal mode", () => {
    // An admin writing it would overwrite the employee's mapping target.
    assert.match(
      SRC,
      /if\s*\(mode\s*===\s*"personal"\)\s*\{\s*await admin\s*\n?\s*\.from\("tasks"\)\s*\n?\s*\.update\(\{\s*google_event_id/,
      "the shared tasks.google_event_id column is personal-mode only"
    );
  });

  it("the mapping table is keyed per user, so one task can hold two event ids", () => {
    assert.match(MODE_MIG, /UNIQUE|per-user|user_id/);
    assert.match(
      MODE_MIG,
      /calendar_events[\s\S]*?ADD COLUMN IF NOT EXISTS sync_mode/,
      "sync_mode records which strategy wrote a mapping row"
    );
  });

  it("adds no second mapping table", () => {
    // The fix is a second SELECT, not new infrastructure.
    assert.equal(
      /CREATE TABLE/i.test(MODE_MIG),
      false,
      "migration 028 must not introduce another mapping table"
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