import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  getInitials,
} from "../lib/utils.ts";

/**
 * Tests for the shared formatting helpers behind the design system.
 *
 * The relative-time formatter is what dense table columns show by
 * default, with the absolute time in the tooltip. Getting the units or
 * the sign wrong is invisible in review and obvious to users ("in -3d",
 * or a two-year-old task labelled "6 months ago"), so the boundaries
 * are pinned here rather than left to eyeballing.
 */

const now = Date.now();
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("keeps sub-45-second ages as 'just now'", () => {
    assert.equal(formatRelativeTime(ago(10_000)), "just now");
  });

  it("reads future sub-45-second timestamps as 'in a moment'", () => {
    // Clock skew between the browser and the database must not render
    // as a negative age.
    assert.equal(formatRelativeTime(new Date(now + 10_000).toISOString()), "in a moment");
  });

  it("steps up through the units", () => {
    assert.equal(formatRelativeTime(ago(5 * MIN)), "5m ago");
    assert.equal(formatRelativeTime(ago(3 * HOUR)), "3h ago");
    assert.equal(formatRelativeTime(ago(2 * DAY)), "2d ago");
    assert.equal(formatRelativeTime(ago(3 * 7 * DAY)), "3w ago");
  });

  it("prefixes future timestamps with 'in'", () => {
    assert.equal(formatRelativeTime(new Date(now + 30 * MIN).toISOString()), "in 30m");
    assert.equal(formatRelativeTime(new Date(now + 2 * DAY).toISOString()), "in 2d");
  });

  it("falls back to an absolute date beyond a month", () => {
    // "5 months ago" is less useful than the date itself on a payment
    // record, and unbounded units would keep growing forever.
    const out = formatRelativeTime(ago(200 * DAY));
    assert.doesNotMatch(out, /ago|^in /);
    assert.match(out, /\d{4}/, "expected a year-bearing absolute date");
  });

  it("degrades safely for missing or unparseable input", () => {
    assert.equal(formatRelativeTime(null), "—");
    assert.equal(formatRelativeTime(undefined), "—");
    assert.equal(formatRelativeTime(""), "—");
    assert.equal(formatRelativeTime("not-a-date"), "—");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders an empty string for missing input", () => {
    // Used for a `title` attribute; "undefined" would be worse than
    // nothing at all.
    assert.equal(formatAbsoluteTime(null), "");
    assert.equal(formatAbsoluteTime("not-a-date"), "");
  });

  it("includes the date and the time", () => {
    const out = formatAbsoluteTime("2026-02-03T10:15:00.000Z");
    assert.match(out, /3/);
    assert.match(out, /Feb/);
    assert.match(out, /2026/);
    assert.match(out, /:/, "expected a time component");
  });
});

describe("getInitials", () => {
  it("uses the first and last name", () => {
    assert.equal(getInitials("Ada Lovelace"), "AL");
  });

  it("handles three or more names", () => {
    assert.equal(getInitials("Ada Byron Lovelace"), "AL");
  });

  it("takes two letters from a single name", () => {
    assert.equal(getInitials("Cher"), "CH");
  });

  it("falls back to a question mark", () => {
    assert.equal(getInitials(null), "?");
    assert.equal(getInitials(""), "?");
    assert.equal(getInitials("   "), "?");
  });
});