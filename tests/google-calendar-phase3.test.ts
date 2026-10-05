import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldSendPush, DEFAULT_PREFERENCES } from "../lib/push-preferences.ts";
import {
  buildEventBody,
  buildAuthorizeParams,
  callbackRedirectUri,
  toCalendarDate,
  addCalendarDays,
  toZonedDateTime,
  backoffDelayMs,
  shouldRetryStatus,
  CALENDAR_TIME_ZONE,
  type SyncableTask,
} from "../lib/google/calendar.ts";

const prefs = (over: Record<string, boolean> = {}) => ({ ...DEFAULT_PREFERENCES, ...over });

/**
 * Phase 3 — Google Calendar.
 *
 * The timezone assertions are behavioural, not source-text. An off-by-one-day
 * in an all-day event is invisible in code review and only shows up as "the
 * meeting is on the wrong day", so the exact failing inputs are pinned here.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const task = (over: Partial<SyncableTask> = {}): SyncableTask => ({
  id: "t1",
  title: "Ship the thing",
  description: null,
  status: "TODO",
  priority: "HIGH",
  deadline: null,
  project_id: "p1",
  google_event_id: null,
  project: null,
  ...over,
});

describe("timezone correctness (the off-by-one-day bug)", () => {
  test("defaults to Asia/Kolkata", () => {
    assert.equal(CALENDAR_TIME_ZONE, "Asia/Kolkata");
  });

  test("an early-morning IST deadline lands on the IST date, not the UTC one", () => {
    // 02:00 IST on the 10th is 20:30 UTC on the NINTH. Slicing the ISO string
    // put the event a day early — this is the regression.
    const inst = new Date("2026-03-10T02:00:00+05:30");
    assert.equal(toCalendarDate(inst), "2026-03-10");
    // Guard the exact bug: the old approach disagrees.
    assert.notEqual(inst.toISOString().slice(0, 10), "2026-03-10");
  });

  test("covers the whole pre-05:30 IST window", () => {
    for (const t of [
      "2026-03-10T00:15:00+05:30",
      "2026-03-10T02:00:00+05:30",
      "2026-03-10T04:30:00+05:30",
      "2026-03-10T05:29:00+05:30",
    ]) {
      assert.equal(toCalendarDate(new Date(t)), "2026-03-10", t);
    }
  });

  test("late-evening IST deadlines do not roll forward either", () => {
    assert.equal(toCalendarDate(new Date("2026-03-10T23:30:00+05:30")), "2026-03-10");
  });

  test("handles month and year boundaries", () => {
    assert.equal(toCalendarDate(new Date("2026-01-01T00:30:00+05:30")), "2026-01-01");
    assert.equal(toCalendarDate(new Date("2026-12-31T23:00:00+05:30")), "2026-12-31");
  });

  test("addCalendarDays crosses month and year ends", () => {
    assert.equal(addCalendarDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29"); // leap year
  });

  test("the event body carries the calendar timezone and correct all-day range", () => {
    const body = buildEventBody(task({ deadline: "2026-03-10T02:00:00+05:30" }));
    assert.equal(body.timeZone, "Asia/Kolkata");
    assert.deepEqual(body.start, { date: "2026-03-10" });
    // End is exclusive — Google requires this for all-day events.
    assert.deepEqual(body.end, { date: "2026-03-11" });
  });

  test("never emits a dateTime for an all-day deadline", () => {
    // Google rejects start.dateTime on an all-day event with a 400.
    const body = buildEventBody(task({ deadline: "2026-03-10T02:00:00+05:30" }));
    assert.ok(!("dateTime" in (body.start as object)));
  });

  test("the no-deadline fallback uses the calendar zone, not UTC", () => {
    const body = buildEventBody(task({ deadline: null }));
    assert.equal((body.start as { timeZone: string }).timeZone, "Asia/Kolkata");
    assert.equal((body.end as { timeZone: string }).timeZone, "Asia/Kolkata");
    assert.match((body.start as { dateTime: string }).dateTime, /\+05:30$/);
  });

  test("an unparseable deadline still produces a valid timed event", () => {
    const body = buildEventBody(task({ deadline: "not-a-date" }));
    assert.ok(body.start, "must not leave start undefined — Google 400s on that");
    assert.equal((body.start as { timeZone: string }).timeZone, "Asia/Kolkata");
  });

  test("toZonedDateTime emits an offset-qualified timestamp", () => {
    const out = toZonedDateTime(new Date("2026-03-10T02:00:00+05:30"));
    assert.match(out, /^2026-03-10T02:00:00\+05:30$/);
  });
});

describe("sync idempotency", () => {
  test("every event is stamped with the task id", () => {
    const body = buildEventBody(task({ id: "abc-123" }));
    const props = body.extendedProperties as { private: Record<string, string> };
    assert.equal(props.private.taskoraTaskId, "abc-123");
  });

  test("rebuilding the body yields identical content", () => {
    // The property the sync relies on to update rather than duplicate.
    const a = buildEventBody(task({ deadline: "2026-03-10T02:00:00+05:30" }));
    const b = buildEventBody(task({ deadline: "2026-03-10T02:00:00+05:30" }));
    assert.deepEqual(a, b);
  });
});

describe("retry policy", () => {
  test("retries only transient failures", () => {
    assert.equal(shouldRetryStatus(429), true);
    assert.equal(shouldRetryStatus(500), true);
    assert.equal(shouldRetryStatus(503), true);
    // Retrying these fails identically forever and hides the real problem.
    assert.equal(shouldRetryStatus(400), false);
    assert.equal(shouldRetryStatus(401), false);
    assert.equal(shouldRetryStatus(403), false);
    assert.equal(shouldRetryStatus(404), false);
  });

  test("backoff grows exponentially and is capped", () => {
    assert.equal(backoffDelayMs(0, 500), 500);
    assert.equal(backoffDelayMs(1, 500), 1000);
    assert.equal(backoffDelayMs(2, 500), 2000);
    assert.ok(backoffDelayMs(10, 500) <= 8000, "must be capped");
  });

  test("backoff never goes negative or NaN", () => {
    assert.equal(backoffDelayMs(-5, 500), 500);
    assert.ok(!Number.isNaN(backoffDelayMs(0)));
  });
});

describe("OAuth is a dedicated flow with CSRF", () => {
  test("requests offline access and forces consent", () => {
    const p = buildAuthorizeParams({
      clientId: "cid",
      redirectUri: "https://app.test/api/auth/google/callback",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      state: "s",
    });
    // Without prompt=consent Google returns a refresh token only the FIRST
    // time, so a reconnecting user silently gets a dead integration.
    assert.equal(p.get("access_type"), "offline");
    assert.equal(p.get("prompt"), "consent");
    assert.equal(p.get("state"), "s");
  });

  test("requests calendar.events and no broad extras", () => {
    const p = buildAuthorizeParams({
      clientId: "cid",
      redirectUri: "u",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      state: "s",
    });
    const scope = p.get("scope") ?? "";
    assert.match(scope, /calendar\.events/);
    assert.doesNotMatch(scope, /drive|mail|contacts/);
  });

  test("redirect URI has no trailing-slash double slash", () => {
    // A double slash is a redirect_uri_mismatch presenting as a generic
    // "Couldn't connect".
    assert.equal(
      callbackRedirectUri("https://app.test/"),
      "https://app.test/api/auth/google/callback"
    );
  });
});

describe("connection state survives a revoked grant", () => {
  const action = () => strip(read("../lib/actions/google-calendar.ts"));

  test("invalid_grant marks NEEDS_RECONNECT instead of deleting the row", () => {
    const src = action();
    assert.match(src, /markNeedsReconnect\(row\.user_id, json\.error\)/);
    // Scoped to getAccessToken. disconnectGoogleCalendar MUST still delete
    // the row — that is an explicit user opt-out, not a dead grant.
    const refresh = src.slice(
      src.indexOf("async function getAccessToken"),
      src.indexOf("async function loadConnectionRow")
    );
    assert.doesNotMatch(
      refresh,
      /\.from\("user_google_tokens"\)\s*\n\s*\.delete\(\)/,
      "a failed refresh must record the state, never erase it"
    );
  });

  test("explicit disconnect still removes the row", () => {
    // Regression guard for the fix above: opt-out is different from failure.
    const src = action();
    const fn = src.slice(src.indexOf("export async function disconnectGoogleCalendar"));
    assert.match(fn, /\.from\("user_google_tokens"\)\s*\n\s*\.delete\(\)/);
  });

  test("records the reason so the UI can explain itself", () => {
    const src = action();
    assert.match(src, /status: "NEEDS_RECONNECT"/);
    assert.match(src, /last_error: reason/);
  });

  test("status distinguishes needs_reconnect from never-connected", () => {
    const src = action();
    assert.match(src, /GoogleConnectionState/);
    assert.match(src, /needs_reconnect/);
    assert.match(src, /"disconnected"/);
    // A dead grant must NOT read as a clean first-time disconnect.
    assert.match(src, /connection\?\.status === "NEEDS_RECONNECT"/);
  });

  test("permanently-failing errors are still not retried", () => {
    const src = action();
    assert.match(src, /PERMANENT_TOKEN_ERRORS/);
    assert.match(src, /invalid_grant/);
  });
});

describe("migration 024", () => {
  const sql = () =>
    read("../supabase/migrations/024_google_connections_and_calendar_events.sql");

  test("creates google_connections with the required columns", () => {
    const s = sql();
    assert.match(s, /CREATE TABLE IF NOT EXISTS public\.google_connections/);
    for (const col of [
      "user_id",
      "encrypted_refresh_token",
      "calendar_id",
      "sync_token",
      "connected_at",
      "status",
    ]) {
      assert.match(s, new RegExp(`\\b${col}\\b`), `missing ${col}`);
    }
  });

  test("constrains status to the documented values", () => {
    assert.match(sql(), /CHECK \(status IN \('ACTIVE', 'NEEDS_RECONNECT', 'ERROR'\)\)/);
  });

  test("never stores a plaintext token column", () => {
    const s = strip(sql());
    // The column must be the ciphertext, not the raw refresh token.
    assert.match(s, /encrypted_refresh_token TEXT NOT NULL/);
    // The negative must not be fooled by the substring inside
    // "encrypted_refresh_token TEXT".
    assert.doesNotMatch(s, /(?<!encrypted_)\brefresh_token\s+TEXT/);
  });

  test("locks connections to read-only for users, writable only by service role", () => {
    const s = sql();
    assert.match(s, /google_connections ENABLE ROW LEVEL SECURITY/);
    assert.match(s, /FOR SELECT TO authenticated\s*\n?\s*USING \(user_id = auth\.uid\(\)\)/);
    // A user-writable connection row could hide a revoked grant.
    assert.doesNotMatch(s, /ON public\.google_connections FOR ALL TO authenticated/);
    assert.match(s, /FOR ALL TO service_role/);
  });

  test("creates calendar_events with unique mapping guarantees", () => {
    const s = sql();
    assert.match(s, /CREATE TABLE IF NOT EXISTS public\.calendar_events/);
    // These constraints are what make re-syncing idempotent.
    assert.match(s, /UNIQUE \(user_id, task_id\)/);
    assert.match(s, /UNIQUE \(user_id, google_event_id\)/);
    assert.match(s, /task_id UUID NOT NULL REFERENCES public\.tasks\(id\) ON DELETE CASCADE/);
  });

  test("backfills existing connections without dropping the old table", () => {
    const s = sql();
    assert.match(s, /INSERT INTO public\.google_connections/);
    assert.match(s, /FROM public\.user_google_tokens/);
    // Dropping a table holding live credentials in the migration that stops
    // reading it is how integrations get lost.
    assert.doesNotMatch(s, /DROP TABLE[^;]*user_google_tokens/);
  });

  test("ship a down migration", () => {
    assert.match(sql(), /DOWN MIGRATION/);
  });
});

describe("mapping is written to calendar_events", () => {
  const action = () => strip(read("../lib/actions/google-calendar.ts"));

  test("upserts the mapping on both create and update", () => {
    const src = action();
    assert.match(src, /recordCalendarEventMapping/);
    assert.match(src, /from\("calendar_events"\)\.upsert\(/);
    assert.match(src, /onConflict: "user_id,task_id"/);
  });

  test("clears the mapping when the event is deleted", () => {
    const src = action();
    assert.match(src, /clearCalendarEventMappingByEvent/);
    assert.match(src, /from\("calendar_events"\)\s*\n?\s*\.delete\(\)/);
  });

  test("reads its own writes — the count comes from calendar_events", () => {
    assert.match(action(), /from\("calendar_events"\)\s*\n?\s*\.select\("id", \{ count: "exact", head: true \}\)/);
  });
});

describe("reconnecting actually clears the failed state", () => {
  const action = () => strip(read("../lib/actions/google-calendar.ts"));

  test("a successful callback writes ACTIVE and clears the error", () => {
    // Regression guard. The status was only ever SET on failure, so a user
    // who reconnected after a revoked grant stayed pinned at
    // NEEDS_RECONNECT forever — the UI would keep insisting their access
    // had expired despite a working consent.
    const src = action();
    const cb = src.slice(
      src.indexOf("export async function handleGoogleCallback"),
      src.indexOf("export async function disconnectGoogleCalendar")
    );
    assert.match(cb, /from\("google_connections"\)\.upsert\(/);
    assert.match(cb, /status: "ACTIVE"/);
    assert.match(cb, /last_error: null/);
    assert.match(cb, /connected_at: new Date\(\)\.toISOString\(\)/);
  });

  test("disconnect clears the connection row as well as the token", () => {
    // A leftover NEEDS_RECONNECT row would make a later fresh connect look
    // like a failed one.
    const src = action();
    const fn = src.slice(
      src.indexOf("export async function disconnectGoogleCalendar"),
      src.indexOf("export async function syncTaskToCalendar")
    );
    assert.match(fn, /from\("google_connections"\)\s*\n\s*\.delete\(\)/);
  });
});

describe("settings UI surfaces the reconnect state", () => {
  const ui = () => strip(read("../components/settings/google-calendar-connect.tsx"));

  test("distinguishes needs_reconnect from never-connected", () => {
    const src = ui();
    assert.match(src, /data\?\.state === "needs_reconnect"/);
    assert.match(src, /needsReconnect/);
  });

  test("offers an explicit Reconnect rather than a bare Connect", () => {
    // "Connect" reads as a first-time invitation; a repair needs its own
    // label or users assume they had never set this up.
    const src = ui();
    assert.match(src, /needsReconnect \? "Reconnect" : "Connect"/);
  });

  test("explains that nothing is syncing, and who it was connected as", () => {
    const src = ui();
    assert.match(src, /no longer valid/);
    assert.match(src, /Last connected as/);
  });

  test("still exposes the full idempotent resync", () => {
    const src = ui();
    assert.match(src, /syncAllTasksToCalendar\(\)/);
    // The label now names the sync mode rather than saying "Sync now"
    // for both an admin's assigned work and an employee's own tasks.
    assert.match(src, /Sync assigned work/);
    assert.match(src, /Sync my assigned tasks/);
    // Idempotency is what makes the button safe to press repeatedly.
    const actionSrc = strip(read("../lib/actions/google-calendar.ts"));
    assert.match(actionSrc, /extendedProperties/);
  });
});

describe("scope minimality", () => {
  const action = () => strip(read("../lib/actions/google-calendar.ts"));
  const scopes = () => {
    const src = action();
    const block = src.slice(src.indexOf("const SCOPES"), src.indexOf("];", src.indexOf("const SCOPES")));
    return [...block.matchAll(/https:\/\/www\.googleapis\.com\/auth\/[\w.]+/g)].map((m) => m[0]);
  };

  test("requests calendar.events and nothing broader", () => {
    // Every endpoint this integration calls is /events or /events/watch,
    // which live entirely under calendar.events. The full "calendar" scope
    // was never needed and is classified SENSITIVE, so it inflates the
    // Production verification burden and grants calendar-wide access.
    assert.deepEqual(scopes(), [
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });

  test("grants no access outside Calendar", () => {
    for (const scope of scopes()) {
      assert.match(scope, /\/auth\/calendar/);
      assert.doesNotMatch(scope, /drive|gmail|mail|contacts|profile|openid/);
    }
  });

  test("every Calendar endpoint used is covered by calendar.events", () => {
    // If a future change adds a /calendarList or /freeBusy call, this
    // fails loudly rather than silently 403-ing in production.
    const src = action();
    const calls = [...src.matchAll(/CALENDAR_API\}\/calendars\/[^`]*?\/([a-zA-Z]+)/g)].map((m) => m[1]);
    for (const segment of new Set(calls)) {
      assert.ok(
        segment === "events",
        `endpoint segment "${segment}" may need a scope beyond calendar.events`
      );
    }
  });
});

describe("retry is actually wired, not merely defined", () => {
  const action = () => strip(read("../lib/actions/google-calendar.ts"));

  test("googleFetch calls the backoff and retry-decision helpers", () => {
    // Regression guard for a real no-op: the helpers existed and were unit
    // tested, but nothing ever called them, so "retried with backoff" was
    // untrue in production.
    const src = action();
    const fn = src.slice(src.indexOf("async function googleFetch"), src.indexOf("// ─", src.indexOf("async function googleFetch")));
    assert.match(fn, /shouldRetryStatus\(/);
    assert.match(fn, /backoffDelayMs\(/);
    assert.match(fn, /await sleep\(/);
  });

  test("attempts are bounded so a sync cannot hang a server action", () => {
    const src = action();
    assert.match(src, /MAX_API_ATTEMPTS = \d+/);
    const fn = src.slice(src.indexOf("async function googleFetch"), src.indexOf("// ─", src.indexOf("async function googleFetch")));
    assert.match(fn, /attempt < MAX_API_ATTEMPTS/);
    assert.match(fn, /attempt === MAX_API_ATTEMPTS - 1/);
  });

  test("a gone sync token is never retried", () => {
    // 410 means "do a full resync", not "try the same call again".
    const src = action();
    const fn = src.slice(src.indexOf("async function googleFetch"), src.indexOf("// ─", src.indexOf("async function googleFetch")));
    assert.match(fn, /instanceof SyncTokenGoneError\) throw err/);
  });
});

describe("a revoked grant notifies the user", () => {
  const action = () => strip(read("../lib/actions/google-calendar.ts"));

  test("markNeedsReconnect both records state and notifies", () => {
    // The spec asked to mark needs_reconnect AND notify. Marking alone left
    // it silent — with a 7-day token in Testing mode that hits every user
    // weekly, so they would not discover it on their own.
    const src = action();
    const fn = src.slice(
      src.indexOf("async function markNeedsReconnect"),
      src.indexOf("/** Row from migration 024")
    );
    assert.match(fn, /status: "NEEDS_RECONNECT"/);
    assert.match(fn, /createNotification\(/);
    assert.match(fn, /GOOGLE_RECONNECT_REQUIRED/);
  });

  test("the notification type exists in the DB enum and the TS union", () => {
    assert.match(read("../types/database.ts"), /"GOOGLE_RECONNECT_REQUIRED"/);
    const sql = read("../supabase/migrations/024_google_connections_and_calendar_events.sql")
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(sql, /ADD VALUE IF NOT EXISTS 'GOOGLE_RECONNECT_REQUIRED'/);
    // 55P04: adding and using the value in one migration is invalid.
    const uses = [...sql.matchAll(/'GOOGLE_RECONNECT_REQUIRED'/g)];
    assert.equal(uses.length, 1, "enum value must be added and never re-used in SQL");
  });

  test("a preference for it is respected rather than hard-coded on", () => {
    // Notifications route through createNotification, so the user's push
    // preferences apply. There is no explicit channel for this type, so the
    // mapping must default to allowed rather than dropping it.
    assert.equal(shouldSendPush(prefs({ push_enabled: false }), "GOOGLE_RECONNECT_REQUIRED"), false);
    assert.equal(shouldSendPush(prefs(), "GOOGLE_RECONNECT_REQUIRED"), true);
  });
});
