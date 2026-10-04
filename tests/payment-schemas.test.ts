import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPaymentSchema,
  markPaidSchema,
  paymentAdjustmentSchema,
  reversePaymentSchema,
  PAYMENT_METHOD_VALUES,
  LEDGER_TYPE_VALUES,
} from "../validators/schemas.ts";

/**
 * Phase 4C — shared payment validation.
 *
 * These schemas are the same object on both sides of the wire: the
 * dialog imports them to show a field error without a round trip, and
 * the server action re-parses with them because the dialog is not a
 * boundary. So the tests here cover two distinct properties:
 *
 *   1. the rules themselves, and
 *   2. that the server actually calls safeParse (a schema nothing parses
 *      is documentation).
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const basePaid = {
  payment_ids: [UUID_A],
  method: "UPI" as const,
};

// ──────────────────────────────────────────────
// markPaid
// ──────────────────────────────────────────────

describe("markPaidSchema", () => {
  it("accepts a minimal valid payload", () => {
    const r = markPaidSchema.safeParse(basePaid);
    assert.ok(r.success, JSON.stringify(r.error?.issues));
  });

  it("refuses an empty selection", () => {
    // A bulk action that silently does nothing is the worst outcome a
    // dialog can produce, so an empty list is an error, not a no-op.
    const r = markPaidSchema.safeParse({ ...basePaid, payment_ids: [] });
    assert.equal(r.success, false);
    assert.match(r.error!.issues[0].message, /at least one payment/i);
  });

  it("refuses an unknown payment method", () => {
    const r = markPaidSchema.safeParse({ ...basePaid, method: "CHEQUE" });
    assert.equal(r.success, false);
  });

  it("accepts every declared method", () => {
    for (const m of PAYMENT_METHOD_VALUES) {
      assert.ok(markPaidSchema.safeParse({ ...basePaid, method: m }).success, `${m} rejected`);
    }
  });

  it("refuses a non-uuid payment id", () => {
    const r = markPaidSchema.safeParse({ ...basePaid, payment_ids: ["not-a-uuid"] });
    assert.equal(r.success, false);
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: 201 }, () => UUID_A);
    assert.equal(markPaidSchema.safeParse({ ...basePaid, payment_ids: many }).success, false);
    assert.equal(markPaidSchema.safeParse({ ...basePaid, payment_ids: many.slice(0, 200) }).success, true);
  });

  it("requires a real YYYY-MM-DD date and rejects an instant", () => {
    assert.ok(markPaidSchema.safeParse({ ...basePaid, paid_on: "2026-10-04" }).success);
    assert.equal(markPaidSchema.safeParse({ ...basePaid, paid_on: "04/10/2026" }).success, false);
    // An ISO instant is rejected on purpose: it would re-interpret the day.
    assert.equal(
      markPaidSchema.safeParse({ ...basePaid, paid_on: "2026-10-04T00:00:00Z" }).success,
      false
    );
  });

  it("treats an empty or absent optional field as absent, not as a value", () => {
    const r = markPaidSchema.safeParse({ ...basePaid, reference_number: "   ", note: "" });
    assert.ok(r.success);
    assert.equal(r.data!.reference_number, undefined);
    assert.equal(r.data!.note, undefined);
  });

  it("trims a supplied reference", () => {
    const r = markPaidSchema.safeParse({ ...basePaid, reference_number: "  UTR123  " });
    assert.equal(r.data!.reference_number, "UTR123");
  });

  it("rejects an over-long reference", () => {
    const r = markPaidSchema.safeParse({ ...basePaid, reference_number: "x".repeat(121) });
    assert.equal(r.success, false);
  });
});

// ──────────────────────────────────────────────
// createPayment
// ──────────────────────────────────────────────

describe("createPaymentSchema", () => {
  const base = { employee_id: UUID_A, title: "October retainer", amount: 1250 };

  it("accepts a minimal valid payment", () => {
    assert.ok(createPaymentSchema.safeParse(base).success);
  });

  it("refuses a zero or negative amount", () => {
    assert.equal(createPaymentSchema.safeParse({ ...base, amount: 0 }).success, false);
    assert.equal(createPaymentSchema.safeParse({ ...base, amount: -100 }).success, false);
  });

  it("refuses a non-numeric amount", () => {
    const r = createPaymentSchema.safeParse({ ...base, amount: "1250" });
    assert.equal(r.success, false, "a string must not coerce into a number");
  });

  it("refuses an absurd amount", () => {
    assert.equal(createPaymentSchema.safeParse({ ...base, amount: 2_000_000_000 }).success, false);
  });

  it("requires an employee", () => {
    assert.equal(createPaymentSchema.safeParse({ ...base, employee_id: "" }).success, false);
  });

  it("defaults the type to CUSTOM and accepts every declared type", () => {
    const r = createPaymentSchema.safeParse(base);
    assert.equal(r.data!.type, "CUSTOM");
    for (const t of LEDGER_TYPE_VALUES) {
      assert.ok(createPaymentSchema.safeParse({ ...base, type: t }).success, `${t} rejected`);
    }
    assert.equal(createPaymentSchema.safeParse({ ...base, type: "NONSENSE" }).success, false);
  });

  it("treats blank optional project and due date as absent", () => {
    const r = createPaymentSchema.safeParse({ ...base, project_id: "", due_date: "" });
    assert.ok(r.success);
    assert.equal(r.data!.due_date, "");
  });
});

// ──────────────────────────────────────────────
// adjustments and reversal
// ──────────────────────────────────────────────

describe("paymentAdjustmentSchema", () => {
  it("accepts a bonus and a deduction", () => {
    assert.ok(paymentAdjustmentSchema.safeParse({ parent_payment_id: UUID_A, amount: 500, reason: "Well done" }).success);
    assert.ok(paymentAdjustmentSchema.safeParse({ parent_payment_id: UUID_A, amount: -500, reason: "Late" }).success);
  });

  it("refuses a zero adjustment", () => {
    // Zero would record nothing while looking like it recorded something.
    const r = paymentAdjustmentSchema.safeParse({ parent_payment_id: UUID_A, amount: 0, reason: "Nothing" });
    assert.equal(r.success, false);
    assert.match(r.error!.issues[0].message, /must not be zero/i);
  });

  it("requires a reason", () => {
    assert.equal(paymentAdjustmentSchema.safeParse({ parent_payment_id: UUID_A, amount: 5, reason: "" }).success, false);
  });
});

describe("reversePaymentSchema", () => {
  it("requires a meaningful reason", () => {
    // Mirrors payments_cancel_complete in the database.
    assert.equal(reversePaymentSchema.safeParse({ payment_id: UUID_A, reason: "x" }).success, false);
    assert.ok(reversePaymentSchema.safeParse({ payment_id: UUID_A, reason: "Duplicate entry" }).success);
    assert.equal(reversePaymentSchema.safeParse({ payment_id: UUID_B, reason: "" }).success, false);
  });
});

// ──────────────────────────────────────────────
// The server must actually use them
// ──────────────────────────────────────────────

describe("server actions validate with the same schemas", () => {
  const actions = read("../lib/actions/payments.ts");

  it("markPaymentsPaidBatch safeParses before writing", () => {
    assert.match(actions, /import \{[^}]*markPaidSchema[^}]*\} from "@\/validators\/schemas"/);
    assert.match(actions, /markPaidSchema\.safeParse\(\{/);
  });

  it("writes the full paid_* triple a PAID row requires", () => {
    // payments_paid_complete demands status, paid_at, paid_by AND
    // payment_method; writing only paid_at would be rejected outright.
    assert.match(actions, /status: "PAID"[\s\S]{0,160}paid_at: paidAt[\s\S]{0,160}paid_by: profile\.id[\s\S]{0,160}payment_method: method/);
  });

  it("anchors a chosen paid_on at midday IST, not midnight UTC", () => {
    // Midnight UTC files an evening payout against the previous day.
    assert.match(actions, /T12:00:00\+05:30/);
  });

  it("the dialog validates before applying the optimistic patch", () => {
    const view = read("../components/payments/admin-payments-view.tsx");
    const fn = view.slice(view.indexOf("async function runBulkMarkPaid"));
    const validateAt = fn.indexOf("markPaidSchema.safeParse");
    const patchAt = fn.indexOf("setQueryData");
    assert.ok(validateAt > -1, "dialog must validate");
    assert.ok(validateAt < patchAt, "validation must precede the optimistic cache patch");
  });

  it("the dialog sends the method, date and reference to the server", () => {
    const view = read("../components/payments/admin-payments-view.tsx");
    assert.match(
      view,
      /markPaymentsPaidBatch\(\s*ids,[\s\S]{0,200}paidMethod[\s\S]{0,120}paidOn[\s\S]{0,120}paidReference/
    );
  });
});