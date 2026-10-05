import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The "Sync now" button on the profile page.
 *
 * This is where the reported bug actually lived. The handler branched
 * on `lastSyncedAt` and fell through to the incremental path, which
 * only ever processes deletions the user made in Google — so once a
 * first sync had run, the button could never create an event again and
 * always reported success. The per-task error list was discarded too,
 * which is how a sync in which every Google call failed still rendered
 * "Calendar is already up to date".
 *
 * Asserted against the source: the panel is a client component with no
 * test renderer in this repo.
 */

const PANEL = readFileSync(
  "components/settings/google-calendar-connect.tsx",
  "utf8"
);

const code = PANEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const handleSync = code.slice(
  code.indexOf("async function handleSync"),
  code.indexOf("async function handleDisconnect")
);

describe("Sync now", () => {
  it("always runs the full sync", () => {
    assert.match(handleSync, /await syncAllTasksToCalendar\(\)/);
    assert.equal(
      /await incrementalSync\(/.test(handleSync),
      false,
      "the incremental path cannot create events"
    );
  });

  it("does not branch on lastSyncedAt", () => {
    assert.equal(
      /lastSyncedAt\s*\?/.test(handleSync),
      false,
      "branching on lastSyncedAt is what made the button a no-op"
    );
  });

  it("no longer imports the incremental action", () => {
    assert.equal(/incrementalSync,/.test(PANEL), false);
  });

  it("surfaces per-task errors before reporting success", () => {
    assert.match(handleSync, /errors\.length\s*>\s*0/);
    assert.match(handleSync, /toast\.error/);
    assert.match(handleSync, /errors\[0\]/);
  });

  it("still reports the counts on a clean run", () => {
    assert.match(handleSync, /r\.created\s*\+\s*r\.updated\s*\+\s*r\.removed\s*===\s*0/);
    assert.match(handleSync, /Calendar is already up to date/);
  });

  it("distinguishes 'nothing matched' from 'nothing changed'", () => {
    // The bug this guards: a sync that matched no tasks reported
    // "already up to date", which is a clean-zero indistinguishable from
    // success. Zero eligible tasks is a different fact and says so.
    assert.match(handleSync, /r\.eligibleTasks\s*===\s*0/);
    assert.match(handleSync, /No eligible/);
    // ...and the up-to-date message reports how many were checked.
    assert.match(handleSync, /eligibleTasks === 1 \? "task" : "tasks"/);
  });

  it("labels the action by the caller's sync mode", () => {
    assert.match(PANEL, /syncMode === "admin_assignment"/);
    assert.match(PANEL, /Sync assigned work/);
    assert.match(PANEL, /Sync my assigned tasks/);
  });

  it("refreshes the status query afterwards", () => {
    assert.match(handleSync, /invalidateQueries/);
  });
});

describe("connection result flags", () => {
  for (const flag of [
    "connected",
    "denied",
    "unauthorized",
    "error",
    "invalid",
    "no_refresh_token",
  ]) {
    it(`handles ?gcal=${flag}`, () => {
      assert.ok(code.includes(`"${flag}"`), `missing ${flag}`);
    });
  }

  it("gives the missing-refresh-token case actionable advice", () => {
    assert.match(code, /myaccount\.google\.com/);
  });
});