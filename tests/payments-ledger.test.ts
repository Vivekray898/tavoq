import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatMoney,
  parseRupeeInput,
  toPaise,
  toRupees,
  PAISE_PER_RUPEE,
} from "../lib/payments/money.ts";
import {
  foldAdjustments,
  resolveLedgerStatus,
  rowAmountPaise,
  applyAdjustmentToItem,
  type PaymentLedgerRow,
} from "../lib/payments/adjustments.ts";

/**
 * Phase 4A — payment ledger: money precision, stored status, and the
 * shape of migration 025.
 *
 * Three things are money, so each is pinned here:
 *
 *   1. Paise conversion. The ledger stores integer paise precisely so
 *      that float rupees cannot drift. A rounding regression would be
 *      invisible on a single row and wrong by thousands on a payroll run.
 *   2. Stored status. Before migration 025 a row's status was inferred
 *      as `paid_at IS NULL ? PENDING : PAID`, which made CANCELLED
 *      inexpressible. resolveLedgerStatus must prefer the column.
 *   3. Migration shape. The constraints that protect the ledger only
 *      exist if the SQL says they do, so the SQL is asserted directly.
 *
 * ── What is NOT covered here ──────────────────────────────────
 * RLS enforcement and the row lock in mark_payments_paid need a real
 * Postgres session with an authenticated caller. Migration 025 is not
 * applied to the live database yet, so those are covered by SQL review
 * plus the manual pass in docs/payments.md, and become an automated RLS
 * suite in Phase 6. The SQL assertions below prove the policy and
 * constraint TEXT is present; they do not prove Postgres enforces it.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const migration = strip(read("../supabase/migrations/025_payment_ledger.sql"));

// ──────────────────────────────────────────────
// Paise conversion
// ──────────────────────────────────────────────

describe("toPaise", () => {
  it("converts rupees to integer paise", () => {
    assert.equal(toPaise(50), 5000);
    assert.equal(toPaise(1250), 125000);
    assert.equal(toPaise(1), 100);
  });

  it("is exact for two-decimal values", () => {
    // Every amount column is NUMERIC(10,2), so two decimals is the
    // domain. These must be exact — no 4999.999999999.
    assert.equal(toPaise(1234.56), 123456);
    assert.equal(toPaise(19.99), 1999);
    assert.equal(toPaise(0.07), 7);
    assert.equal(toPaise(0.01), 1);
  });

  it("rounds half away from zero in BOTH directions", () => {
    // Math.round(-0.5) is -0 in JavaScript, so a naive implementation
    // would round a negative half-paisa toward zero while rounding a
    // positive one away from it. On a deduction that flips the sign of
    // the correction.
    assert.equal(toPaise(0.005), 1);
    assert.equal(toPaise(-0.005), -1);
    assert.equal(toPaise(0.015), 2);
    assert.equal(toPaise(-0.015), -2);
  });

  it("accepts a numeric string, as a text input arrives", () => {
    assert.equal(toPaise("1250.50"), 125050);
    assert.equal(toPaise("50"), 5000);
  });

  it("keeps signed amounts signed (bonuses and deductions)", () => {
    assert.equal(toPaise(500), 50000); // bonus
    assert.equal(toPaise(-500), -50000); // deduction
    assert.equal(toPaise(-0.5), -50);
  });

  it("returns 0 for absent or non-finite input rather than NaN", () => {
    // A NaN reaching a payroll total renders as "₹NaN", which is worse
    // than a zero that the DB CHECK can reject.
    assert.equal(toPaise(null), 0);
    assert.equal(toPaise(undefined), 0);
    assert.equal(toPaise(Number.NaN), 0);
    assert.equal(toPaise(Number.POSITIVE_INFINITY), 0);
    assert.equal(toPaise("abc"), 0);
  });

  it("clamps an out-of-safe-range amount instead of wrapping", () => {
    const huge = 1e18;
    assert.equal(toPaise(huge), 0);
  });
});

describe("toRupees", () => {
  it("divides by 100 and tolerates absent input", () => {
    assert.equal(toRupees(125000), 1250);
    assert.equal(toRupees(-50000), -500);
    assert.equal(toRupees(null), 0);
    assert.equal(toRupees(Number.NaN), 0);
  });

  it("round-trips with toPaise for two-decimal values", () => {
    for (const rupees of [50, 1234.56, 19.99, 0.07, 100000]) {
      assert.equal(toRupees(toPaise(rupees)), rupees);
    }
  });

  it("exposes the paise-per-rupee constant", () => {
    assert.equal(PAISE_PER_RUPEE, 100);
  });
});

describe("formatMoney", () => {
  it("renders INR with two decimals", () => {
    assert.equal(formatMoney(125000), "₹1,250.00");
    assert.equal(formatMoney(5000), "₹50.00");
    assert.equal(formatMoney(1), "₹0.01");
  });

  it("applies Indian digit grouping (lakh/crore), not thousands", () => {
    // en-IN renders 100000 as 1,00,000. This is the whole point of the
    // helper: ₹1,00,000 is what an Indian payroll reader expects.
    assert.equal(formatMoney(10000000), "₹1,00,000.00");
    assert.equal(formatMoney(123456789), "₹12,34,567.89");
    assert.equal(formatMoney(100000), "₹1,000.00");
  });

  it("keeps the sign outside the symbol for deductions", () => {
    assert.equal(formatMoney(-50000), "-₹500.00");
  });

  it("always shows two decimals so a column of amounts aligns", () => {
    assert.equal(formatMoney(500000), "₹5,000.00");
    assert.equal(formatMoney(50000000), "₹5,00,000.00");
  });

  it("degrades safely for null and non-finite input", () => {
    assert.equal(formatMoney(null), "₹0.00");
    assert.equal(formatMoney(undefined), "₹0.00");
    assert.equal(formatMoney(Number.NaN), "₹0.00");
  });

  it("labels a non-INR currency without pretending to be a rupee sign", () => {
    assert.equal(formatMoney(125000, "USD"), "USD 1,250.00");
  });
});

describe("parseRupeeInput", () => {
  it("accepts the shapes a person actually types", () => {
    assert.equal(parseRupeeInput("1250"), 125000);
    assert.equal(parseRupeeInput("1,250.50"), 125050);
    assert.equal(parseRupeeInput("₹1250"), 125000);
    assert.equal(parseRupeeInput(" 50 "), 5000);
    assert.equal(parseRupeeInput("-500"), -50000); // deduction
  });

  it("returns null for input the caller must reject with a field error", () => {
    // Number("") is 0 and Number("1,250") is NaN, so neither can be fed
    // straight to toPaise() — an empty field would silently pay ₹0.
    assert.equal(parseRupeeInput(""), null);
    assert.equal(parseRupeeInput("   "), null);
    assert.equal(parseRupeeInput("abc"), null);
    assert.equal(parseRupeeInput("12.5.5"), null);
    assert.equal(parseRupeeInput("-"), null);
    assert.equal(parseRupeeInput(null), null);
    assert.equal(parseRupeeInput(undefined), null);
  });
});

// ──────────────────────────────────────────────
// Stored ledger status
// ──────────────────────────────────────────────

describe("resolveLedgerStatus", () => {
  it("prefers the stored column", () => {
    assert.equal(resolveLedgerStatus({ status: "PENDING", paid_at: null }), "PENDING");
    assert.equal(resolveLedgerStatus({ status: "PAID", paid_at: "2026-10-01T00:00:00Z" }), "PAID");
    assert.equal(resolveLedgerStatus({ status: "CANCELLED", paid_at: null }), "CANCELLED");
  });

  it("falls back to the paid_at inference for pre-025 rows", () => {
    assert.equal(resolveLedgerStatus({ status: null, paid_at: "2026-10-01T00:00:00Z" }), "PAID");
    assert.equal(resolveLedgerStatus({ status: undefined, paid_at: null }), "PENDING");
    assert.equal(resolveLedgerStatus({}), "PENDING");
  });

  it("never lets a cancelled row read as paid", () => {
    // The regression this guards: a CANCELLED payment that kept its
    // paid_at would be counted as paid money that left the bank.
    assert.equal(resolveLedgerStatus({ status: "CANCELLED", paid_at: "2026-10-01T00:00:00Z" }), "CANCELLED");
  });
});

describe("rowAmountPaise", () => {
  it("prefers amount_paise", () => {
    assert.equal(rowAmountPaise({ amount_paise: 125050, amount: 1250.5 }), 125050);
  });

  it("accepts amount_paise delivered as a string over PostgREST", () => {
    // BIGINT comes back from PostgREST as a JSON number, but a NUMERIC
    // cast or a JSON string would break Number() if unguarded.
    assert.equal(rowAmountPaise({ amount_paise: "125050", amount: 1250.5 }), 125050);
  });

  it("derives from `amount` when the column is absent", () => {
    assert.equal(rowAmountPaise({ amount: 1250.5 }), 125050);
    assert.equal(rowAmountPaise({ amount_paise: null, amount: 50 }), 5000);
  });
});

// ──────────────────────────────────────────────
// Adjustment folding still nets out in paise
// ──────────────────────────────────────────────

describe("foldAdjustments with paise", () => {
  const base = (over: Partial<PaymentLedgerRow> = {}): PaymentLedgerRow => ({
    id: "pay-1",
    task_id: "task-1",
    employee_id: "emp-1",
    description: null,
    amount: 1000,
    amount_paise: 100000,
    paid_at: "2026-10-01T10:00:00Z",
    payment_note: null,
    created_at: "2026-10-01T10:00:00Z",
    kind: "PAYMENT",
    parent_payment_id: null,
    employee: [{ full_name: "Asha" }],
    paid_by_profile: null,
    task: { id: "task-1", title: "Design", project: null },
    ...over,
  } as PaymentLedgerRow);

  it("nets a bonus into the parent's amount and paise together", () => {
    const rows = [
      base(),
      base({
        id: "adj-1",
        amount: 200,
        amount_paise: 20000,
        kind: "ADJUSTMENT",
        parent_payment_id: "pay-1",
        description: "Well done",
      }),
    ];
    const items = foldAdjustments(rows);
    const parent = items.find((i) => i.id === "pay-1");
    assert.ok(parent);
    assert.equal(parent.amount_paise, 120000);
    assert.equal(parent.amount, 1200);
    assert.equal(parent.base_amount_paise, 100000);
  });

  it("nets a negative deduction", () => {
    const rows = [
      base(),
      base({
        id: "adj-1",
        amount: -250,
        amount_paise: -25000,
        kind: "ADJUSTMENT",
        parent_payment_id: "pay-1",
        description: "Late delivery",
      }),
    ];
    const parent = foldAdjustments(rows).find((i) => i.id === "pay-1");
    assert.ok(parent);
    assert.equal(parent.amount_paise, 75000);
    assert.equal(parent.adjustments[0].amount_paise, -25000);
  });

  it("keeps amount and amount_paise consistent when summing many rows", () => {
    // 0.01 × 3 summed as rupees drifts; summed as paise it does not.
    const rows = [
      base({ id: "pay-1", amount: 0.01, amount_paise: 1, parent_payment_id: null }),
      base({ id: "pay-2", amount: 0.01, amount_paise: 1, parent_payment_id: null }),
      base({ id: "pay-3", amount: 0.01, amount_paise: 1, parent_payment_id: null }),
    ];
    const totalPaise = foldAdjustments(rows).reduce((s, i) => s + i.amount_paise, 0);
    assert.equal(totalPaise, 3);
  });

  it("reads a cancelled row as CANCELLED, not as unpaid", () => {
    const parent = foldAdjustments([base({ status: "CANCELLED", paid_at: null })]).find(
      (i) => i.id === "pay-1"
    );
    assert.ok(parent);
    assert.equal(parent.status, "CANCELLED");
  });

  it("applyAdjustmentToItem keeps both amount representations in step", () => {
    const parent = foldAdjustments([base()]).find((i) => i.id === "pay-1");
    assert.ok(parent);
    const patched = applyAdjustmentToItem(parent, {
      id: "adj-1",
      amount: 200,
      amount_paise: 20000,
      reason: "Bonus",
      created_at: "2026-10-02T10:00:00Z",
      actor_name: null,
    });
    assert.equal(patched.amount_paise, 120000);
    assert.equal(patched.amount, 1200);
    assert.equal(patched.adjustment_total, 200);
  });
});

// ──────────────────────────────────────────────
// Migration 025 shape
// ──────────────────────────────────────────────

describe("migration 025 — enum naming", () => {
  it("creates a ledger-specific status enum, not `payment_status`", () => {
    // `payment_status` already exists on `tasks` with NOT_APPLICABLE |
    // PENDING | PAID. Creating it again fails outright, and merging the
    // two would repoint task code and make CANCELLED inexpressible there.
    assert.match(migration, /CREATE TYPE public\.payment_ledger_status/);
    assert.match(migration, /'PENDING',\s*'PAID',\s*'CANCELLED'/);
    assert.doesNotMatch(
      migration,
      /CREATE TYPE public\.payment_status/
    );
  });

  it("never adds a value to the tasks payment_status enum", () => {
    assert.doesNotMatch(migration, /ALTER TYPE public\.payment_status/);
  });

  it("keeps the 019 kind marker and adds a separate type", () => {
    assert.match(migration, /payment_type_enum/);
    assert.doesNotMatch(migration, /DROP COLUMN[^;]*\bkind\b/);
    assert.doesNotMatch(migration, /DROP COLUMN[^;]*parent_payment_id/);
  });
});

describe("migration 025 — money columns", () => {
  it("adds amount_paise as BIGINT with currency defaulting to INR", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS amount_paise BIGINT/);
    assert.match(migration, /currency TEXT NOT NULL DEFAULT 'INR'/);
  });

  it("backfills paise from amount by a factor of 100", () => {
    assert.match(migration, /amount_paise = round\(amount \* 100\)::BIGINT/);
  });

  it("never references NEW inside a policy predicate", () => {
    // This is the bug that actually broke the apply:
    //   ERROR: 42703: column "new" does not exist
    //   At statement: CREATE POLICY "Ledger create" ... WITH CHECK (...NEW...)
    //
    // NEW/OLD exist only in trigger functions and RETURNING clauses. In a
    // policy expression the row is named by the TABLE, so the call must be
    // can_manage_payment(payments).
    // `migration` still has block comments removed but keeps `--` lines,
    // and the §4 prose above the trigger quotes "CREATE POLICY ...
    // WITH CHECK" as the bug's origin. Strip line comments before matching
    // so only real policy statements are inspected.
    const code = migration.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    const policies = code.match(/CREATE POLICY[\s\S]*?;/gi) ?? [];
    assert.ok(policies.length >= 4, "expected the 4 ledger policies");
    for (const p of policies) {
      assert.doesNotMatch(p, /\bNEW\b/, `policy references NEW: ${p.slice(0, 70)}`);
      assert.doesNotMatch(p, /\bOLD\b/, `policy references OLD: ${p.slice(0, 70)}`);
    }
    assert.match(
      migration,
      /CREATE POLICY "Ledger create"[\s\S]*?WITH CHECK \(public\.can_manage_payment\(payments\)/
    );
  });

  it("keeps `amount` in step with a trigger", () => {
    // The trigger is legitimate and stays: a trigger function is exactly
    // where NEW/OLD are legal. It was briefly removed while chasing an
    // unrelated policy-level NEW error, which cost a needless regression.
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.payments_sync_amount\(\)[\s\S]*?RETURNS TRIGGER[\s\S]*?LANGUAGE plpgsql/
    );
    assert.match(
      migration,
      /CREATE TRIGGER payments_sync_amount\s*\n\s*BEFORE INSERT OR UPDATE OF amount_paise, amount ON public\.payments/
    );
    // NEW must appear ONLY inside that function's body.
    const executable = migration
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");
    const triggerBody = executable.slice(
      executable.indexOf("FUNCTION public.payments_sync_amount")
    );
    const outside = executable.slice(
      0,
      executable.indexOf("FUNCTION public.payments_sync_amount")
    );
    assert.doesNotMatch(outside, /\bNEW\b/);
    assert.match(triggerBody, /NEW\.amount := \(NEW\.amount_paise::NUMERIC \/ 100\)/);
  });

  it("keeps the dual write in every payments INSERT/UPDATE payload", () => {
    // `amount` has been NOT NULL since migration 001 and nine read paths
    // still sum it (employees.ts, dashboard.ts, getMyEarnings). Dropping
    // it from the write payloads would fail every insert AND make those
    // sums NaN, so both columns must be written from the same value.
    const src = read("../lib/actions/payments.ts");

    // A DB write is the adjacent pair `amount_paise: toPaise(amount),`
    // followed by the bare `amount,` that fills the legacy column.
    // Return payloads also carry amount_paise (as `base_amount_paise`
    // pairs) but write no columns, so the adjacency test is what
    // distinguishes a real insert/update from a function's return value.
    const payloads = src.match(/amount_paise: toPaise\(amount\),\n\s*amount,/g) ?? [];
    assert.equal(
      payloads.length,
      3,
      "expected 3 DB write payloads (task batch, custom, adjustment) writing both amounts"
    );
  });

  it("still repairs a legacy amount that disagreed with the backfill", () => {
    // The replacement has to keep the reconciliation the trigger implied.
    assert.match(
      migration,
      /SET amount_paise = round\(amount \* 100\)::BIGINT\s*WHERE amount_paise IS DISTINCT FROM round\(amount \* 100\)::BIGINT/
    );
  });

  it("allows signed amounts only for adjustments", () => {
    // A blanket `amount_paise > 0` would reject every bonus and every
    // deduction, since 019 records those as signed rows.
    assert.match(migration, /payments_amount_positive/);
    assert.match(migration, /CHECK \(kind = 'ADJUSTMENT' OR amount_paise > 0\)/);
    assert.match(migration, /CHECK \(amount_paise <> 0\)/);
  });
});

describe("migration 025 — constraints", () => {
  it("requires the full paid triple when status is PAID", () => {
    assert.match(migration, /payments_paid_complete/);
    assert.match(
      migration,
      /status <> 'PAID'\s*OR \(paid_at IS NOT NULL AND paid_by IS NOT NULL AND payment_method IS NOT NULL\)/
    );
  });

  it("requires a reason whenever a payment is cancelled", () => {
    assert.match(migration, /payments_cancel_complete/);
    assert.match(migration, /NULLIF\(BTRIM\(cancel_reason\), ''\) IS NOT NULL/);
  });

  it("backfills a method for legacy PAID rows before adding the CHECK", () => {
    // Ordering matters: three legacy PAID rows have no method, so the
    // backfill must precede payments_paid_complete or validation fails.
    const backfill = migration.indexOf("SET payment_method = 'OTHER'");
    const constraint = migration.indexOf("payments_paid_complete");
    assert.ok(backfill > -1, "legacy method backfill missing");
    assert.ok(constraint > -1, "paid-complete constraint missing");
    assert.ok(
      backfill < constraint,
      "payment_method must be backfilled BEFORE payments_paid_complete is added"
    );
  });

  it("backfills status from paid_at", () => {
    assert.match(
      migration,
      /SET status = CASE WHEN paid_at IS NOT NULL THEN 'PAID'[\s\S]{0,80}'PENDING'/
    );
  });

  it("makes payee NOT NULL and backfills it from employee_id", () => {
    assert.match(migration, /ALTER COLUMN payee SET NOT NULL/);
    assert.match(migration, /SET payee = employee_id/);
  });
});

describe("migration 025 — indexes", () => {
  const required = [
    "idx_payments_status_paid_at",
    "idx_payments_employee_status",
    "idx_payments_project_id",
    "idx_payments_due_date",
  ];

  for (const name of required) {
    it(`creates ${name}`, () => {
      assert.ok(
        migration.includes(`CREATE INDEX IF NOT EXISTS ${name}`),
        `${name} is missing`
      );
    });
  }

  it("creates the partial unique index for one active task payout", () => {
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_active_task_payout/);
    // The predicate must exclude CANCELLED, or cancelling a payment
    // would permanently block re-issuing that task's payout.
    assert.match(
      migration,
      /uq_payments_active_task_payout[\s\S]*?WHERE kind = 'PAYMENT'[\s\S]*?AND type = 'TASK_PAYOUT'[\s\S]*?AND status <> 'CANCELLED'/
    );
  });
});

describe("migration 025 — payment_events", () => {
  it("logs the four lifecycle actions", () => {
    assert.match(migration, /'CREATED', 'PAID', 'REVERSED', 'CANCELLED', 'UPDATED'/);
    assert.match(migration, /INSERT INTO public\.payment_events/);
  });

  it("has RLS enabled with no UPDATE or DELETE policy at all", () => {
    // Insert-only is enforced by the ABSENCE of those policies, not by a
    // restrictive trigger — the structural form cannot drift.
    assert.match(migration, /ALTER TABLE public\.payment_events ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /ON public\.payment_events FOR UPDATE/);
    assert.doesNotMatch(migration, /ON public\.payment_events FOR DELETE/);
    assert.match(migration, /REVOKE UPDATE, DELETE ON public\.payment_events FROM authenticated/);
  });

  it("records from/to status and metadata", () => {
    assert.match(migration, /from_status public\.payment_ledger_status/);
    assert.match(migration, /to_status public\.payment_ledger_status/);
    assert.match(migration, /metadata JSONB NOT NULL DEFAULT '\{\}'::JSONB/);
  });
});

describe("migration 025 — RPCs", () => {
  it("marks payments paid under a row lock", () => {
    // FOR UPDATE is what stops two concurrent bulk actions from both
    // reading PENDING and both paying the same row.
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_payments_paid/);
    assert.match(migration, /FOR UPDATE/);
    assert.match(migration, /SET search_path = public/);
  });

  it("requires an active manager or super admin, read from profiles", () => {
    assert.match(
      migration,
      /FROM public\.profiles[\s\S]{0,160}status = 'ACTIVE'[\s\S]{0,80}role IN \('SUPER_ADMIN', 'MANAGER'\)/
    );
  });

  it("is idempotent — an already-paid row is skipped, not paid twice", () => {
    assert.match(migration, /IF prior_status = 'PAID' THEN[\s\S]{0,120}'skipped'/);
    assert.match(migration, /IF prior_status = 'CANCELLED' THEN[\s\S]{0,120}'cancelled'/);
  });

  it("rejects paying a task payout whose task is not APPROVED", () => {
    assert.match(
      migration,
      /WHERE t\.id = r\.task_id AND t\.status = 'APPROVED'/
    );
    assert.match(migration, /can only be paid once the task is APPROVED/);
  });

  it("keeps PAID consistent with the CHECK by clearing paid_* on reverse", () => {
    // reverse_payment sets status back to PENDING, so leaving paid_at set
    // would violate payments_paid_complete.
    const reverse = migration.slice(migration.indexOf("FUNCTION public.reverse_payment"));
    assert.match(reverse, /SET status = 'PENDING'/);
    assert.match(reverse, /paid_at = NULL/);
    assert.match(reverse, /paid_by = NULL/);
    assert.match(reverse, /payment_method = NULL/);
  });

  it("requires a reason for both reverse and cancel, and both are super-admin only", () => {
    for (const fn of ["reverse_payment", "cancel_payment"]) {
      const body = migration.slice(migration.indexOf(`FUNCTION public.${fn}`));
      const uptoEnd = body.slice(0, body.indexOf("$$;"));
      assert.match(uptoEnd, /is_active_admin\(\)/, `${fn} must be admin-only`);
      assert.match(uptoEnd, /A reason is required/, `${fn} must require a reason`);
    }
  });

  it("summarises in ONE rpc with per-window counts", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_payments_summary/);
    // The all-time-count bug: "Paid this week" was rendered with the
    // lifetime count, so the week and month need their own counters.
    assert.match(migration, /paid_this_week_count BIGINT/);
    assert.match(migration, /paid_this_month_count BIGINT/);
    assert.match(migration, /paid_last_week BIGINT/);
    assert.match(migration, /paid_last_month BIGINT/);
  });

  it("scopes the summary to what the caller may manage", () => {
    const body = migration.slice(migration.indexOf("FUNCTION public.get_payments_summary"));
    assert.match(body, /WHERE public\.can_manage_payment\(p\)/);
  });
});

describe("migration 025 — RLS", () => {
  it("replaces the too-broad staff FOR ALL policy from migration 014", () => {
    assert.match(
      migration,
      /DROP POLICY IF EXISTS "Active staff manages payments" ON public\.payments/
    );
  });

  it("lets employees read only their own rows", () => {
    assert.match(migration, /CREATE POLICY "Ledger read scope"/);
    const policy = migration.slice(migration.indexOf('CREATE POLICY "Ledger read scope"'));
    assert.match(policy, /employee_id = auth\.uid\(\)/);
    assert.match(policy, /payee = auth\.uid\(\)/);
  });

  it("restricts edits to PENDING rows", () => {
    // A PAID payment is never edited in place — it is reversed, which
    // leaves an audit event.
    assert.match(
      migration,
      /CREATE POLICY "Ledger edit while pending"[\s\S]*?USING \(public\.can_manage_payment\(payments\) AND status = 'PENDING'\)/
    );
  });

  it("reserves cancel and reverse for super admins", () => {
    assert.match(
      migration,
      /CREATE POLICY "Ledger cancel or reverse"[\s\S]*?USING \(public\.is_active_admin\(\)\)/
    );
  });

  it("scopes a manager to the projects they manage", () => {
    assert.match(migration, /public\.can_manage_project\(payment_row\.project_id\)/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.can_manage_payment/);
  });

  it("declares every user-callable data function SECURITY INVOKER", () => {
    // scripts/verify-rpc-security.mjs fails the build on a user-callable
    // data function that is SECURITY DEFINER: DEFINER bypasses RLS and
    // would hand a caller rows they may not read. The §9 policies ARE the
    // authorization; these functions must not route around them.
    //
    // Asserted here as well so the regression is caught by the unit suite
    // rather than only by the build.
    assert.doesNotMatch(migration, /SECURITY\s+DEFINER/);

    const invoker = migration.match(/SECURITY\s+INVOKER/g) ?? [];
    // can_manage_payment, mark_payments_paid, reverse_payment,
    // cancel_payment, get_payments_summary.
    assert.ok(invoker.length >= 5, `expected ≥5 INVOKER declarations, got ${invoker.length}`);
  });
});

describe("migration 025 — rollback safety", () => {
  it("documents a rollback", () => {
    assert.match(migration, /ROLLBACK/);
  });

  it("drops no pre-existing column or table", () => {
    // Every change must be additive, so a rollback is a DROP of the new
    // objects and the original 11 columns survive untouched.
    assert.doesNotMatch(migration, /DROP TABLE (IF EXISTS )?public\.payments/);
    assert.doesNotMatch(migration, /DROP COLUMN/);
    assert.doesNotMatch(migration, /RENAME/);
  });

  it("keeps the dual-write column for the follow-up migration", () => {
    // `amount` is intentionally retained; a later migration drops it
    // once no call site references it (see docs/payments.md).
    assert.match(migration, /dropped in a later migration/i);
  });
});