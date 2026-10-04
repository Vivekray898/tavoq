import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEventBody, type SyncableTask } from "../lib/google/calendar.ts";

/**
 * The calendar event payload.
 *
 * Google rejects an all-day event that carries `dateTime`, and rejects
 * an event with no `start` at all — both as a 400 with a body nobody
 * was reading. These assertions pin the two shapes we actually send.
 */

function task(over: Partial<SyncableTask> = {}): SyncableTask {
  return {
    id: "task-1",
    title: "Design the landing page",
    description: "Hero, pricing, footer",
    status: "IN_PROGRESS",
    priority: "HIGH",
    deadline: "2026-02-03T00:00:00.000Z",
    project_id: "proj-1",
    google_event_id: null,
    project: { name: "Website", client: { name: "Acme" } },
    ...over,
  };
}

describe("buildEventBody — all-day events", () => {
  it("uses start.date, never start.dateTime", () => {
    const body = buildEventBody(task());
    assert.deepEqual(body.start, { date: "2026-02-03" });
    assert.equal("dateTime" in (body.start as object), false);
  });

  it("formats the date as YYYY-MM-DD, not an ISO timestamp", () => {
    const body = buildEventBody(task({ deadline: "2026-02-03T18:45:00.000Z" }));
    assert.match((body.start as { date: string }).date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("ends exclusively on the following day", () => {
    // Google treats `end.date` as exclusive; the same-day value would
    // render as a zero-length event.
    const body = buildEventBody(task());
    assert.deepEqual(body.end, { date: "2026-02-04" });
  });

  it("stamps the task id so a re-sync updates in place", () => {
    const body = buildEventBody(task());
    assert.deepEqual(body.extendedProperties, {
      private: { taskoraTaskId: "task-1" },
    });
  });
});

describe("buildEventBody — tasks with no deadline", () => {
  it("never sends an undefined start", () => {
    // Google answers 400 for a missing start, which surfaced as a
    // per-task error and a "successful" sync that created nothing.
    const body = buildEventBody(task({ deadline: null }));
    assert.ok(body.start, "start must always be present");
  });

  it("falls back to a one-hour timed event rather than an all-day one", () => {
    const body = buildEventBody(task({ deadline: null }));
    const start = body.start as { dateTime: string; timeZone: string };
    const end = body.end as { dateTime: string; timeZone: string };
    assert.ok(start.dateTime, "expected a timed event");
    // CHANGED IN PHASE 3. This asserted "UTC", which is what made the
    // all-day date land a day early for deadlines before 05:30 IST. The
    // calendar now defaults to Asia/Kolkata, per the phase spec.
    assert.equal(start.timeZone, "Asia/Kolkata");
    assert.equal(end.timeZone, "Asia/Kolkata");
    const hours =
      (new Date(end.dateTime).getTime() - new Date(start.dateTime).getTime()) / 3_600_000;
    assert.equal(hours, 1);
  });

  it("falls back when the deadline is unparseable, not just null", () => {
    const body = buildEventBody(task({ deadline: "not-a-date" }));
    assert.ok(body.start);
  });
});

describe("buildEventBody — description", () => {
  it("carries project, client, priority and status", () => {
    const desc = buildEventBody(task()).description as string;
    assert.match(desc, /Project: Website/);
    assert.match(desc, /Client: Acme/);
    assert.match(desc, /Priority: HIGH/);
    assert.match(desc, /Status: IN_PROGRESS/);
    assert.match(desc, /Taskora task id: task-1/);
  });

  it("omits blank lines rather than emitting empty ones", () => {
    const desc = buildEventBody(
      task({ description: "   ", project: null })
    ).description as string;
    assert.equal(desc.includes("\n\n"), false);
  });

  it("trims the task description", () => {
    const desc = buildEventBody(task({ description: "  padded  " })).description as string;
    assert.ok(desc.startsWith("padded"), "leading whitespace should be trimmed");
  });
});