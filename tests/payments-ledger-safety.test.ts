import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression tests for the payment-ledger safety repair (migrations 026
 * and 027).
 *
 * These assert the SQL *text*, so they run with no database and catch a
 * future edit that quietly re-arms a destructive foreign key. The
 * semantics themselves are proved by executing them:
 * tests/e2e/payments-ledger-safety.db.test.ts.
 *
 * Context: the live audit found that deleting a task silently deleted
 * the payments it had generated, because payments.task_id cascaded.
 * Two of the database's four original payment rows were already gone by
 * the time this was found.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (name: string) =>
  readFileSync(join(ROOT, "supabase", "migrations", name), "utf8");

/** Line comments carry prose that repeats the very patterns being banned. */
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "");

const m026 = read("026_preserve_payment_ledger_history.sql");
const m027 = read("027_task_payout_orphan_guard.sql");

describe("026 — payments outlive the records around them", () => {
  it("points payments.task_id at ON DELETE SET NULL, not CASCADE", () => {
    assert.match(
      m026,
      /ADD CONSTRAINT payments_task_id_fkey\s+FOREIGN KEY \(task_id\)\s+REFERENCES public\.tasks\(id\) ON DELETE SET NULL/,
    );
  });

  it("never re-arms CASCADE on any payments foreign key", () => {
    const executable = strip(m026);
    // The rollback block documents how to restore CASCADE, but it is a
    // comment, so stripping comments must leave no CASCADE at all.
    assert.equal(
      /ADD CONSTRAINT[\s\S]*?ON DELETE CASCADE/.test(executable),
      false,
      "026 must not leave a payments foreign key cascading on delete",
    );
  });

  it("refuses to hard-delete a person who has pay history", () => {
    assert.match(
      m026,
      /ADD CONSTRAINT payments_employee_id_fkey\s+FOREIGN KEY \(employee_id\)\s+REFERENCES public\.profiles\(id\) ON DELETE RESTRICT/,
    );
  });

  it("keeps the audit trail: a payment with events cannot be deleted", () => {
    assert.match(
      m026,
      /ADD CONSTRAINT payment_events_payment_id_fkey\s+FOREIGN KEY \(payment_id\)\s+REFERENCES public\.payments\(id\) ON DELETE RESTRICT/,
    );
  });

  it("drops and re-adds by name, so a missing constraint fails loudly", () => {
    for (const name of [
      "payments_task_id_fkey",
      "payments_employee_id_fkey",
      "payment_events_payment_id_fkey",
    ]) {
      assert.match(m026, new RegExp(`DROP CONSTRAINT ${name}`));
      assert.match(m026, new RegExp(`ADD CONSTRAINT ${name}`));
    }
  });

  it("touches no payment data at all", () => {
    const executable = strip(m026);
    // `ON DELETE` contains the word DELETE; what must not appear is DML.
    const dml = executable
      .replace(/ON DELETE/g, "")
      .match(/\b(INSERT INTO|UPDATE |DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/g);
    assert.equal(dml, null, `026 must not contain data manipulation: ${dml}`);
  });

  it("carries a rollback that does not silently forget the trigger", () => {
    assert.match(m026, /-- ROLLBACK/);
    assert.match(m026, /payments_task_id_fkey[\s\S]*?ON DELETE CASCADE/);
  });
});

describe("027 — the orphan guard replaces the CHECK it would break", () => {
  it("drops the CHECK that made task deletion impossible", () => {
    assert.match(m027, /DROP CONSTRAINT payments_task_payout_has_task/);
  });

  it("still refuses a TASK_PAYOUT written with no task", () => {
    assert.match(
      m027,
      /IF NEW\.type = 'TASK_PAYOUT' AND NEW\.task_id IS NULL THEN[\s\S]*?RAISE EXCEPTION/,
    );
  });

  it("only permits the NULL when the foreign key itself did it", () => {
    // The distinguishing detail: an UPDATE whose OLD row had a task.
    assert.match(
      m027,
      /IF NOT \(TG_OP = 'UPDATE' AND OLD\.task_id IS NOT NULL\) THEN/,
    );
  });

  it("is a BEFORE trigger, so it can see OLD", () => {
    assert.match(
      m027,
      /CREATE TRIGGER trigger_payments_task_payout_guard\s+BEFORE INSERT OR UPDATE ON public\.payments/,
    );
  });

  it("declares RETURNS TRIGGER and closes its dollar quote", () => {
    const executable = strip(m027);
    assert.match(executable, /RETURNS TRIGGER/);
    assert.equal(
      (executable.match(/\$\$/g) ?? []).length % 2,
      0,
      "unbalanced $$ would leave the migration half-parsed",
    );
    assert.equal(
      executable.split("(").length - executable.split(")").length,
      0,
      "unbalanced parentheses",
    );
  });

  it("stops settled history from blocking an unrelated delete", () => {
    assert.match(
      m027,
      /ADD CONSTRAINT payments_employee_required\s+CHECK \(\(employee_id IS NOT NULL\) OR \(task_id IS NOT NULL\) OR \(status <> 'PENDING'\)\)/,
    );
  });
});

describe("the paid transition writes a complete, atomic state", () => {
  const src = readFileSync(join(ROOT, "lib", "actions", "payments.ts"), "utf8");
  const action = src.slice(
    src.indexOf("export async function markPaymentsPaidBatch"),
    src.indexOf("export async function", src.indexOf("export async function markPaymentsPaidBatch") + 10),
  );

  it("writes status in the same statement as the paid_* triple", () => {
    // Anchor on the update call itself. Slicing to `updateError` looks
    // right but stops one line early: the variable is destructured on the
    // line *before* the statement it names.
    const start = action.indexOf(".update({");
    const end = action.indexOf(".in(", start);
    assert.ok(start > -1 && end > start, "expected a payments update call");
    const update = action.slice(start, end);
    for (const field of [
      "status:",
      "paid_at:",
      "paid_by:",
      "payment_method:",
    ]) {
      assert.ok(
        update.includes(field),
        `mark-paid update must set ${field} — a partial write leaves paid_at populated while status still reads PENDING`,
      );
    }
    assert.equal(
      (update.match(/\.update\(/g) ?? []).length >= 1,
      true,
      "the transition must be a single update statement, not a sequence",
    );
  });

  it("marks status PAID explicitly rather than inferring it", () => {
    assert.match(action, /status: "PAID"/);
  });

  it("is idempotent: it only selects rows that are still unpaid", () => {
    assert.match(action, /\.is\("paid_at", null\)/);
    assert.match(action, /already paid/);
  });

  it("anchors a chosen paid_on day with an explicit offset", () => {
    // A bare `new Date("2026-01-01")` is parsed as UTC midnight and shifts
    // the recorded day for any ledger timezone west of Greenwich. The
    // offset is spelled out, so the server's own timezone is irrelevant.
    assert.match(action, /new Date\(`\$\{paidOnDay\}T12:00:00\+05:30`\)\.toISOString\(\)/);
    assert.equal(
      /new Date\(paidOnDay\)/.test(action),
      false,
      "must not parse the day without an explicit offset",
    );
  });
});
