import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Cron and Google Calendar contract tests.
 *
 * These are static and behavioural-by-inspection rather than
 * end-to-end: the cron route needs a running Vercel deployment, and
 * the calendar sync needs two connected Google accounts. What can be
 * proven without either is that the guards and de-duplication
 * contracts are present and correctly ordered — which is where these
 * have historically broken.
 *
 * The live delivery paths are covered by the manual QA checklists in
 * docs/realtime-qa.md and docs/google-calendar.md.
 */

const CRON = readFileSync(
  "app/api/cron/daily-reminders/route.ts",
  "utf8"
);
const MIDDLEWARE = readFileSync("proxy.ts", "utf8");
const VERCEL = readFileSync("vercel.json", "utf8");
const CALENDAR = readFileSync("lib/actions/google-calendar.ts", "utf8");

/** Strip comments so prose is not mistaken for code. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("cron endpoint", () => {
  it("verifies CRON_SECRET before doing any work", () => {
    const body = code(CRON).slice(
      code(CRON).indexOf("export async function GET")
    );
    const guardAt = body.indexOf("CRON_SECRET");
    const dbAt = body.indexOf("createAdminClient");

    assert.ok(guardAt > -1, "the handler must read CRON_SECRET");
    assert.ok(
      guardAt < dbAt,
      "the secret check must come before any database work"
    );
  });

  it("returns 401 when the header does not match", () => {
    assert.match(code(CRON), /status:\s*401/);
  });

  it("fails closed when CRON_SECRET is unset", () => {
    // `!secret ||` means an unset secret rejects everyone rather than
    // allowing everyone through.
    assert.match(code(CRON), /!secret\s*\|\|/);
  });

  it("is reachable without a session (not redirected to /login)", () => {
    assert.match(
      MIDDLEWARE,
      /"\/api\/cron"/,
      "the proxy must treat /api/cron as public so the handler's own secret check runs"
    );
  });

  it("de-duplicates per user, task and day", () => {
    // The UNIQUE constraint is the mechanism; a second run on the same
    // day cannot double-notify.
    const migration = readFileSync(
      "supabase/migrations/012_google_calendar_integration.sql",
      "utf8"
    );
    assert.match(
      migration,
      /UNIQUE\s*\(\s*user_id\s*,\s*task_id\s*,\s*reminder_date\s*\)/i
    );
  });

  it("reports a JSON body on success", () => {
    assert.match(code(CRON), /NextResponse\.json\(\{\s*ok:\s*true/);
  });

  it("is registered on a schedule in vercel.json", () => {
    const parsed = JSON.parse(VERCEL) as {
      crons?: { path: string; schedule: string }[];
    };
    const cron = parsed.crons?.find(
      (c) => c.path === "/api/cron/daily-reminders"
    );
    assert.ok(cron, "the cron job must be registered in vercel.json");
    // Vercel cron is 5 fields: minute hour day-of-month month day-of-week.
    // "0 5 * * *" is 05:00 UTC daily. (An earlier version of this
    // assertion used /^\d+ \* \* \* \*$/, which wrongly rejected the
    // hour field and failed on a perfectly valid schedule.)
    const fields = cron!.schedule.trim().split(/\s+/);
    assert.equal(fields.length, 5, `expected 5 cron fields, got ${cron!.schedule}`);
  });
});

describe("calendar ownership", () => {
  it("pushes only tasks belonging to the caller's own sync mode", () => {
    // PERSONAL: assigned_to = caller. ADMIN: created_by = caller. Either
    // way the row is scoped to the signed-in user, and the mode is read
    // from their role rather than chosen by the request.
    const src = code(CALENDAR);
    const single = src.slice(src.indexOf("export async function syncTaskToCalendar"));
    assert.match(
      single.slice(0, single.indexOf("\n}")),
      /\.eq\(\s*mode\s*===\s*["']admin_assignment["']\s*\?\s*["']created_by["']\s*:\s*["']assigned_to["']\s*,\s*profile\.id\s*\)/
    );

    const selector = src.slice(src.indexOf("async function getTasksForCalendarSync"));
    assert.match(
      selector.slice(0, selector.indexOf("\n}")),
      /\.eq\(\s*mode\s*===\s*["']admin_assignment["']\s*\?\s*["']created_by["']\s*:\s*["']assigned_to["']\s*,\s*userId\s*\)/
    );

    const full = src.slice(src.indexOf("async function fullSyncForUser"));
    assert.match(full, /getTasksForCalendarSync\(userId,\s*mode\)/);
  });

  it("clears google_event_id when a task changes hands", () => {
    const migration = readFileSync(
      "supabase/migrations/016_calendar_ownership.sql",
      "utf8"
    );
    const m = code(migration);
    assert.match(m, /NEW\.assigned_to\s+IS\s+DISTINCT\s+FROM\s+OLD\.assigned_to/);
    assert.match(m, /NEW\.google_event_id\s*:=\s*NULL/);
    assert.match(m, /BEFORE\s+UPDATE\s+ON\s+public\.tasks/);
  });

  it("deletes the event for a completed task rather than annotating it", () => {
    // The documented behaviour, asserted so it cannot change silently.
    const full = code(CALENDAR).slice(
      code(CALENDAR).indexOf("async function fullSyncForUser")
    );
    assert.match(
      full,
      /status\s*===\s*["']COMPLETED["'][\s\S]{0,900}?deleteEvent\(/,
      "a completed task's event must be deleted, not annotated"
    );
    // ...and the mapping is dropped for THIS user only, so another user's
    // copy of the same task survives.
    assert.match(full, /forgetMapping\(/);
    assert.match(full, /\.eq\(\s*["']user_id["']\s*,\s*userId\s*\)/);
    assert.match(code(CALENDAR).slice(0), /COMPLETED/);
  });

  it("disconnect removes the token row, so a reconnect does a full sync", () => {
    // Deleting the row also drops the sync cursor with it, so the next
    // connection starts from fullSyncForUser rather than an incremental
    // diff with no baseline.
    const src = code(CALENDAR);
    const disconnect = src.slice(src.indexOf("export async function disconnectGoogleCalendar"));
    assert.match(
      disconnect.slice(0, disconnect.indexOf("\n}")),
      /\.delete\(\)[\s\S]*?\.eq\(\s*["']user_id["']\s*,\s*profile\.id\s*\)/,
      "disconnect must delete the caller's token row"
    );
  });

  it("full sync is idempotent: PUT when an event exists, POST only when it does not", () => {
    // Re-running a full sync must not create a second event for the
    // same task, which is what makes disconnect/reconnect safe.
    const src = code(CALENDAR);
    const full = src.slice(src.indexOf("async function fullSyncForUser"));
    const body = full.slice(0, full.indexOf("\n}"));

    const putAt = body.indexOf('method: "PUT"');
    const postAt = body.indexOf('method: "POST"');
    assert.ok(putAt > -1, "an existing event must be updated, not recreated");
    assert.ok(postAt > putAt, "creation must be the fallback, after the update path");
    // The existence test is this user's mapping, not the task-global column.
    assert.match(body, /if\s*\(existing\)/);
    assert.match(
      body,
      /calendar_events[\s\S]{0,300}?\.eq\("user_id",\s*userId\)/
    );
  });

  it("collects per-task errors instead of aborting the batch", () => {
    // One revoked grant must not stop everyone else's sync.
    const src = code(CALENDAR);
    const full = src.slice(src.indexOf("async function fullSyncForUser"));
    assert.match(full, /result\.errors\.push\(/);
    assert.match(full, /catch\s*\(err\)/);
  });

  it("uses no service account", () => {
    assert.equal(/service[_-]?account/i.test(code(CALENDAR)), false);
  });

  it("adds no outbound cron", () => {
    // Reconciliation rides the existing daily cron; a second outbound
    // job would reintroduce the fan-out this model avoids.
    const parsed = JSON.parse(VERCEL) as { crons?: unknown[] };
    const paths = (parsed.crons ?? []).map(
      (c) => (c as { path: string }).path
    );
    assert.equal(
      paths.filter((p) => p.includes("calendar")).length,
      0,
      "there should be no calendar outbound cron"
    );
  });
});