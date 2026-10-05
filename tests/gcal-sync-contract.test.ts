import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contracts inside lib/actions/google-calendar.ts and the callback
 * route.
 *
 * That module is `"use server"` and imports next/headers, the Supabase
 * clients and the auth helpers, so the test runner cannot load it —
 * these are asserted against the source instead, the same way
 * tests/calendar-ownership.test.ts already guards this feature. The
 * pieces that *could* be loaded (the authorize params, the event body)
 * are unit-tested for real in tests/gcal-authorize-url.test.ts and
 * tests/gcal-event-body.test.ts; only the server-runtime-only branches
 * live here.
 *
 * Each case below is a failure that has actually been observed.
 */

const SRC = readFileSync("lib/actions/google-calendar.ts", "utf8");
const CALLBACK = readFileSync("app/api/auth/google/callback/route.ts", "utf8");

/** Strip comments so prose is not mistaken for code. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const src = code(SRC);

/** The body of a named function, up to the next top-level closing brace. */
function bodyOf(name: string): string {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start > -1, `${name} not found`);
  return src.slice(start, src.indexOf("\n}", start));
}

describe("task selection", () => {
  const fullSync = src.slice(src.indexOf("async function fullSyncForUser"));
  const selector = src.slice(src.indexOf("async function getTasksForCalendarSync"));

  it("selects by the caller's mode: assigned_to or created_by", () => {
    assert.match(
      selector.slice(0, selector.indexOf("\n}")),
      /\.eq\(\s*mode\s*===\s*"admin_assignment"\s*\?\s*"created_by"\s*:\s*"assigned_to"\s*,\s*userId\s*\)/
    );
    assert.match(fullSync, /getTasksForCalendarSync\(userId,\s*mode\)/);
  });

  it("skips completed tasks rather than filtering them in SQL", () => {
    // Done in the loop so a completed task can still have its mapping
    // cleared; an SQL filter would strand the event id.
    assert.match(fullSync, /if\s*\(\s*task\.status\s*===\s*"COMPLETED"\s*\)/);
    assert.match(fullSync, /google_event_id:\s*null/);
  });

  it("does not require google_event_id to be null", () => {
    // Such a filter would make an update impossible and silently drop
    // every already-synced task.
    assert.equal(
      fullSync.includes('.not("google_event_id", "is", null)'),
      false
    );
  });

  it("is idempotent: PUT when an event exists, POST when it does not", () => {
    assert.match(fullSync, /if\s*\(\s*existing\s*\)/);
    assert.match(fullSync, /method:\s*"PUT"/);
    assert.match(fullSync, /method:\s*"POST"/);
    const putAt = fullSync.indexOf('method: "PUT"');
    const postAt = fullSync.indexOf('method: "POST"');
    assert.ok(putAt < postAt, "the existing-event branch must come first");
  });

  it("writes the created event id to the per-user mapping", () => {
    // calendar_events, NOT tasks.google_event_id — the latter is global to
    // the task and would overwrite the other user's mapping target.
    assert.match(
      fullSync,
      /recordCalendarEventMapping\(userId,\s*task\.id,\s*created\.id,\s*mode\)/
    );
    assert.match(fullSync, /if\s*\(mode\s*===\s*"personal"\)\s*\{\s*\n?\s*await admin\s*\n?\s*\.from\("tasks"\)/);
  });
});

describe("a zero-change run must explain itself", () => {
  const fullSync = src.slice(src.indexOf("async function fullSyncForUser"));

  it("reports every eligibility bucket, not just the changes", () => {
    for (const field of [
      "rawTasksLoaded",
      "eligibleTasks",
      "skippedCompleted",
      "skippedMissingDeadline",
      "skippedOther",
      "alreadyMapped",
      "created",
      "updated",
      "removed",
      "unchanged",
      "errors",
    ]) {
      assert.match(
        src,
        new RegExp(`${field}\\s*:`),
        `SyncResult must carry ${field}`
      );
    }
  });

  it("counts the skips it performs", () => {
    assert.match(fullSync, /result\.skippedCompleted\s*\+=/);
    assert.match(fullSync, /result\.skippedMissingDeadline\s*\+=/);
    assert.match(fullSync, /result\.eligibleTasks\s*\+=/);
    assert.match(fullSync, /result\.alreadyMapped\s*\+=/);
  });

  it("records which strategy ran", () => {
    assert.match(src, /mode:\s*CalendarSyncMode/);
    assert.match(fullSync, /describeSyncResult\(result\)/);
  });

  it("treats a 2xx with no event id as a failure", () => {
    // Otherwise the run reports created:0 with no error, which is the
    // exact shape of the bug being fixed.
    assert.match(fullSync, /if\s*\(!created\??\.id\)/);
    assert.match(fullSync, /returned success without an event id/);
  });

  it("logs the calendar id, never a credential", () => {
    assert.match(fullSync, /console\.log\("\[gcal-sync\] run"/);
    assert.match(src, /describeSyncResult[\s\S]*?calendarId/);
    // The summary must not carry token material. Bounded to the function
    // body so an unrelated helper later in the file cannot fail this.
    const start = src.indexOf("function describeSyncResult");
    const summary = src.slice(start, src.indexOf("\n}", start));
    assert.doesNotMatch(summary, /accessToken|refreshToken|clientSecret|Authorization/);
  });
});

describe("refresh-token exchange", () => {
  const getAccess = bodyOf("getAccessToken");

  it("mints a new access token with the refresh_token grant", () => {
    assert.match(getAccess, /grant_type:\s*"refresh_token"/);
  });

  it("decrypts before sending the refresh token", () => {
    assert.ok(
      getAccess.indexOf("decryptToken") < getAccess.indexOf("grant_type"),
      "the ciphertext must never be sent to Google"
    );
  });

  it("reuses a cached token only while it is still comfortably valid", () => {
    assert.match(getAccess, /Date\.now\(\)\s*\+\s*60_000/);
  });

  it("throws an actionable error when the grant fails", () => {
    // The silent variant is how an expired/revoked grant produced a
    // green UI with nothing synced.
    assert.match(getAccess, /json\.error_description\s*\|\|\s*json\.error/);
    assert.match(getAccess, /throw new Error/);
  });

  it("persists a rotated refresh token", () => {
    assert.match(getAccess, /rotated\s*\?\s*\{\s*refresh_token:\s*rotated\s*\}/);
  });
});

describe("error handling", () => {
  it("turns a non-2xx into an error carrying status and message", () => {
    assert.match(src, /Google API \$\{res\.status\}: \$\{/);
  });

  it("treats 410 as an expired cursor rather than a hard failure", () => {
    assert.match(src, /res\.status\s*===\s*410/);
    assert.match(src, /throw new SyncTokenGoneError\(\)/);
  });

  it("re-runs a full sync when the cursor is gone", () => {
    const inc = src.slice(src.indexOf("export async function incrementalSyncForUser"));
    const handler = inc.slice(inc.indexOf("if (err instanceof SyncTokenGoneError)"));
    assert.match(
      handler.slice(0, 500),
      /update\(\{\s*sync_token:\s*null\s*\}/,
      "a 410 must clear the stale cursor"
    );
    assert.match(
      handler.slice(0, 600),
      /return fullSyncForUser\(userId,\s*mode\)/,
      "a 410 must fall back to a full re-sync"
    );
  });

  it("collects per-task errors instead of aborting the batch", () => {
    assert.match(src, /result\.errors\.push\(/);
    assert.match(src, /catch\s*\(err\)/);
  });

  it("logs the token endpoint's failure body", () => {
    assert.match(src, /\[google\] token exchange failed/);
  });
});

describe("callback", () => {
  it("validates state against the cookie and the session user", () => {
    assert.match(CALLBACK, /expectedState\s*!==\s*state/);
    assert.match(CALLBACK, /user\.id\s*!==\s*userId/);
    assert.match(CALLBACK, /expired/);
  });

  it("exchanges the code with the same redirect_uri the authorize step used", () => {
    assert.match(SRC, /redirect_uri:\s*callbackRedirectUri\(appUrl\(\)\)/);
    assert.equal((SRC.match(/callbackRedirectUri\(appUrl\(\)\)/g) ?? []).length, 2);
  });

  it("fails explicitly when Google returns no refresh token", () => {
    assert.match(src, /if\s*\(!json\.refresh_token\)/);
    assert.match(src, /"NO_REFRESH_TOKEN"/);
    assert.match(src, /no refresh_token in callback response/);
  });

  it("routes that case to its own redirect flag", () => {
    assert.match(CALLBACK, /gcal=.*no_refresh_token|"no_refresh_token"/);
  });

  it("identifies the account through the supported userinfo endpoint", () => {
    // calendar/v3/users/me was retired and answers 404 for every
    // token, which is why the UI showed the literal "unknown".
    assert.match(SRC, /googleapis\.com\/oauth2\/v2\/userinfo/);
    // The retired endpoint must not be the one actually called — the
    // comments explaining the change still name it.
    assert.equal(
      /fetch\(\s*`?\$\{CALENDAR_API\}\/users\/me/.test(src),
      false
    );
  });

  it("encrypts the refresh token before it is written", () => {
    assert.match(SRC, /refresh_token:\s*encryptToken\(json\.refresh_token\)/);
  });

  it("reuses the row on reconnect and resets the cursor", () => {
    assert.match(SRC, /onConflict:\s*"user_id"/);
    assert.match(SRC, /sync_token:\s*null/);
  });
});