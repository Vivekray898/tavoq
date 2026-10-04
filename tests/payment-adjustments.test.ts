import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { foldAdjustments, type PaymentLedgerRow } from "../lib/payments/adjustments.ts";

/**
 * Payment adjustments — bonuses and deductions on already-paid rows.
 *
 * The ledger is append-only: an adjustment is a NEW payments row that
 * points at its parent, never a mutation of the original, and it is
 * reversed by recording the opposite amount. Two consequences are
 * enforced here, because both are money:
 *
 *   1. An adjustment must never appear as its own row. The parent still
 *      exists, so surfacing both would double-count it.
 *   2. The parent's `amount` must equal base + sum(children), so every
 *      existing rollup (ERP strip, per-employee totals, employee
 *      earnings) is correct without knowing adjustments exist.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

let seq = 0;
const row = (over: Partial<PaymentLedgerRow> = {}): PaymentLedgerRow => ({
  id: `p${++seq}`,
  task_id: "task-1",
  employee_id: "emp-1",
  description: null,
  amount: 500,
  paid_at: "2026-10-01T10:00:00Z",
  payment_note: null,
  created_at: "2026-10-01T10:00:00Z",
  kind: "PAYMENT",
  parent_payment_id: null,
  employee: [{ full_name: "Asha", email: "asha@example.com" }],
  paid_by_profile: null,
  task: {
    id: "task-1",
    title: "Landing page",
    project: { name: "Acme", client: { name: "Acme Co" } },
  },
  ...over,
});

describe("an adjustment never becomes its own row", () => {
  test("a bonus is folded into its parent, not listed separately", () => {
    const parent = row({ amount: 500 });
    const bonus = row({
      amount: 200,
      kind: "ADJUSTMENT",
      parent_payment_id: parent.id,
      description: "Diwali bonus",
      created_at: "2026-10-03T10:00:00Z",
      paid_by_profile: [{ full_name: "Creativoxa" }],
    });

    const items = foldAdjustments([parent, bonus]);

    assert.equal(items.length, 1, "the adjustment must not appear as a second row");
    assert.equal(items[0].id, parent.id);
    assert.equal(items[0].amount, 700, "net must be base + bonus");
  });

  test("a deduction reduces the net", () => {
    const parent = row({ amount: 500 });
    const deduction = row({
      amount: -50,
      kind: "ADJUSTMENT",
      parent_payment_id: parent.id,
      description: "Partial correction",
    });

    const items = foldAdjustments([parent, deduction]);

    assert.equal(items.length, 1);
    assert.equal(items[0].amount, 450);
  });

  test("several adjustments sum, and the net is base + sum(children)", () => {
    const parent = row({ amount: 500 });
    const rows = [
      parent,
      row({ amount: 200, kind: "ADJUSTMENT", parent_payment_id: parent.id, created_at: "2026-10-02T00:00:00Z" }),
      row({ amount: -50, kind: "ADJUSTMENT", parent_payment_id: parent.id, created_at: "2026-10-04T00:00:00Z" }),
      row({ amount: 25, kind: "ADJUSTMENT", parent_payment_id: parent.id, created_at: "2026-10-03T00:00:00Z" }),
    ];

    const items = foldAdjustments(rows);
    const expected = 500 + 200 - 50 + 25;

    assert.equal(items.length, 1);
    assert.equal(items[0].adjustments.length, 3);
    assert.equal(items[0].base_amount, 500);
    assert.equal(items[0].adjustment_total, 175);
    assert.equal(items[0].amount, expected);
  });

  test("adjustments are ordered oldest first, so the trail reads forwards", () => {
    const parent = row({ amount: 100 });
    const items = foldAdjustments([
      parent,
      row({ amount: 3, kind: "ADJUSTMENT", parent_payment_id: parent.id, created_at: "2026-10-09T00:00:00Z" }),
      row({ amount: 1, kind: "ADJUSTMENT", parent_payment_id: parent.id, created_at: "2026-10-02T00:00:00Z" }),
      row({ amount: 2, kind: "ADJUSTMENT", parent_payment_id: parent.id, created_at: "2026-10-05T00:00:00Z" }),
    ]);

    assert.deepEqual(items[0].adjustments.map((a) => a.amount), [1, 2, 3]);
  });

  test("a reversal restores the original amount exactly", () => {
    const parent = row({ amount: 500 });
    const bonus = row({ amount: 200, kind: "ADJUSTMENT", parent_payment_id: parent.id });
    const reversal = row({ amount: -200, kind: "ADJUSTMENT", parent_payment_id: parent.id });

    const items = foldAdjustments([parent, bonus, reversal]);

    assert.equal(items.length, 1);
    assert.equal(items[0].amount, 500);
    assert.equal(items[0].adjustments.length, 2, "the reversal stays on the record");
  });
});

describe("a payment with no adjustments is untouched", () => {
  test("amount === base_amount and the list is empty", () => {
    const items = foldAdjustments([row({ amount: 750 })]);
    assert.equal(items[0].amount, 750);
    assert.equal(items[0].base_amount, 750);
    assert.equal(items[0].adjustment_total, 0);
    assert.deepEqual(items[0].adjustments, []);
  });

  test("existing rollups keep working unchanged", () => {
    // Every summary in the workspace sums `item.amount`. Because that is
    // the net, the ERP strip and per-employee totals are correct with
    // no adjustment-specific code in them.
    const a = row({ amount: 100, id: "a" });
    const b = row({ amount: 200, id: "b" });
    const items = foldAdjustments([
      a,
      b,
      row({ amount: 50, kind: "ADJUSTMENT", parent_payment_id: "a" }),
    ]);
    assert.equal(items.reduce((sum, i) => sum + i.amount, 0), 350);
  });
});

describe("parent/child integrity", () => {
  test("an adjustment pointing at a missing parent is surfaced, never dropped", () => {
    // Silently discarding money is the one failure this must never have,
    // so an orphan is returned as its own row.
    const orphan = row({
      amount: -75,
      kind: "ADJUSTMENT",
      parent_payment_id: "does-not-exist",
      description: "Orphaned deduction",
    });

    const items = foldAdjustments([orphan]);

    assert.equal(items.length, 1, "an orphan adjustment must stay visible");
    assert.equal(items[0].amount, -75);
  });

  test("two parents do not cross-contaminate", () => {
    const a = row({ amount: 100, id: "pa" });
    const b = row({ amount: 200, id: "pb" });
    const items = foldAdjustments([
      a,
      b,
      row({ amount: 10, kind: "ADJUSTMENT", parent_payment_id: "pa" }),
    ]);

    const itemA = items.find((i) => i.id === "pa")!;
    const itemB = items.find((i) => i.id === "pb")!;
    assert.equal(itemA.amount, 110);
    assert.equal(itemB.amount, 200);
    assert.equal(itemB.adjustments.length, 0);
  });

  test("an adjustment carries the reason and who recorded it", () => {
    const parent = row({ amount: 500 });
    const items = foldAdjustments([
      parent,
      row({
        amount: 100,
        kind: "ADJUSTMENT",
        parent_payment_id: parent.id,
        description: "Diwali bonus",
        paid_by_profile: [{ full_name: "Creativoxa" }],
      }),
    ]);

    const adj = items[0].adjustments[0];
    assert.equal(adj.reason, "Diwali bonus");
    assert.equal(adj.actor_name, "Creativoxa");
  });
});

describe("createPaymentAdjustment enforces the rules server-side", () => {
  const action = strip(read("../lib/actions/payments.ts"));

  test("requires active staff", () => {
    const fn = action.slice(action.indexOf("export async function createPaymentAdjustment"));
    assert.match(fn, /requireStaff\(\)/);
  });

  test("rejects a zero amount", () => {
    const fn = action.slice(action.indexOf("export async function createPaymentAdjustment"));
    assert.match(fn, /amount === 0/);
    assert.match(fn, /Number\.isFinite\(amount\)/);
  });

  test("requires a non-empty reason, trimmed", () => {
    const fn = action.slice(action.indexOf("export async function createPaymentAdjustment"));
    assert.match(fn, /input\.reason\.trim\(\)/);
    assert.match(fn, /A reason is required/);
  });

  test("refuses a parent that is not paid", () => {
    const fn = action.slice(action.indexOf("export async function createPaymentAdjustment"));
    assert.match(fn, /if \(!parent\.paid_at\)/);
  });

  test("refuses a parent that is itself an adjustment (no daisy chains)", () => {
    const fn = action.slice(action.indexOf("export async function createPaymentAdjustment"));
    assert.match(fn, /\(parent\.kind \?\? "PAYMENT"\) !== "PAYMENT"/);
  });

  test("inserts a new append-only row, never an update", () => {
    const fn = action.slice(action.indexOf("export async function createPaymentAdjustment"));
    assert.match(fn, /kind: "ADJUSTMENT"/);
    assert.match(fn, /parent_payment_id: parent\.id/);
    // The parent must not be mutated.
    assert.doesNotMatch(fn, /\.from\("payments"\)[\s\S]{0,40}\.update\(/);
  });

  test("notifies the employee with the signed amount and reason", () => {
    const fn = action.slice(action.indexOf("export async function createPaymentAdjustment"));
    assert.match(fn, /sendEventEmail\("PAYMENT_PAID"/);
    assert.match(fn, /Bonus.*Deduction|bonus \? "Bonus"/);
  });
});

describe("the database enforces what the action assumes", () => {
  const sql = read("../supabase/migrations/019_payment_adjustments.sql");

  test("adds kind with a default so existing rows are unchanged", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'PAYMENT'/);
  });

  test("adds parent_payment_id as a self-reference", () => {
    assert.match(sql, /parent_payment_id UUID\s*\n?\s*REFERENCES public\.payments\(id\)/);
  });

  test("constrains kind to the two known values", () => {
    assert.match(sql, /CHECK \(kind IN \('PAYMENT', 'ADJUSTMENT'\)\)/);
  });

  test("an adjustment must have a parent and cannot point at itself", () => {
    assert.match(sql, /kind = 'ADJUSTMENT' AND parent_payment_id IS NOT NULL/);
    assert.match(sql, /parent_payment_id <> id/);
  });

  test("is idempotent", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
    assert.match(sql, /DROP CONSTRAINT IF EXISTS/);
  });

  test("does not weaken or replace the payments RLS", () => {
    assert.doesNotMatch(sql, /DROP POLICY|CREATE POLICY|ALTER POLICY/);
  });
});