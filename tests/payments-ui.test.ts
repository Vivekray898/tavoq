import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dateColumnLabel,
  emailLocalPart,
  employeeDisplayName,
  employeeInitials,
  paymentSubLine,
} from "../lib/payments/display.ts";
import {
  LEDGER_PAYMENT_TYPE_LABELS,
  LEDGER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from "../lib/constants.ts";
import { recomputeSummary, type PaymentItem } from "../lib/payments/adjustments.ts";

/**
 * Phase 4B — payments page UI.
 *
 * The defects this covers were all *presentation* bugs that no type
 * checker catches, because every one of them type-checks perfectly:
 *
 *   • "Paid this week" captioned an all-time count
 *   • an employee with no name rendered as the literal word "EMPLOYEE"
 *   • the same person appeared as initials on one screen, a name on
 *     another, and a role on a third
 *   • a pending row's created date looked identical to a paid row's
 *     paid date
 *
 * So the rules are pinned in a pure module that the view imports,
 * rather than re-derived inside JSX where nothing can assert them.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// ──────────────────────────────────────────────
// Employee label: name, then email, never a role
// ──────────────────────────────────────────────

describe("employeeDisplayName", () => {
  it("prefers the full name", () => {
    assert.equal(
      employeeDisplayName({ full_name: "Priya Sharma", email: "priya@example.com" }),
      "Priya Sharma"
    );
  });

  it("falls back to the email when no name is set", () => {
    // The regression: this used to render the role string, so the cell
    // read "EMPLOYEE" and two people were indistinguishable.
    assert.equal(
      employeeDisplayName({ full_name: null, email: "priya.sharma@example.com" }),
      "Priya Sharma"
    );
    assert.equal(
      employeeDisplayName({ full_name: "", email: "ravi@example.com" }),
      "Ravi"
    );
  });

  it("never returns a role string, whatever it is given", () => {
    for (const role of ["EMPLOYEE", "MANAGER", "SUPER_ADMIN"]) {
      const label = employeeDisplayName({ full_name: null, email: null });
      assert.ok(!label.includes(role), `label must never contain ${role}`);
      assert.equal(label, "Unassigned");
    }
  });

  it("never returns initials", () => {
    const label = employeeDisplayName({ full_name: "Bhavna Prasad", email: null });
    assert.equal(label, "Bhavna Prasad");
    assert.notEqual(label, "B.P.");
  });

  it("treats whitespace-only names as absent", () => {
    assert.equal(employeeDisplayName({ full_name: "   ", email: "x@y.com" }), "X");
  });

  it("reports Unassigned when there is no person at all", () => {
    assert.equal(employeeDisplayName(null), "Unassigned");
    assert.equal(employeeDisplayName(undefined), "Unassigned");
    assert.equal(employeeDisplayName({}), "Unassigned");
  });

  it("gives the same label for the same person on every call", () => {
    const person = { full_name: null, email: "sam.lee@example.com" };
    const first = employeeDisplayName(person);
    assert.equal(employeeDisplayName(person), first);
    assert.equal(employeeDisplayName({ ...person }), first);
  });
});

describe("emailLocalPart", () => {
  it("tidies separators and title-cases", () => {
    assert.equal(emailLocalPart("priya.sharma@x.com"), "Priya Sharma");
    assert.equal(emailLocalPart("ravi_kumar@x.com"), "Ravi Kumar");
    assert.equal(emailLocalPart("deepa-nair@x.com"), "Deepa Nair");
  });

  it("returns empty for an unusable local part", () => {
    assert.equal(emailLocalPart("@example.com"), "");
    assert.equal(emailLocalPart(""), "");
  });

  it("keeps a multi-word local part readable", () => {
    assert.equal(emailLocalPart("mary.jane.watson@x.com"), "Mary Jane Watson");
  });
});

describe("employeeInitials", () => {
  it("uses first and last initials", () => {
    assert.equal(employeeInitials({ full_name: "Bhavna Prasad" }), "BP");
    assert.equal(employeeInitials({ full_name: "Mary Jane Watson" }), "MW");
  });

  it("handles a single name", () => {
    assert.equal(employeeInitials({ full_name: "Cher" }), "CH");
  });

  it("returns empty when there is no real name", () => {
    // The avatar must not invent initials from an email — that was one
    // of the two inconsistent labels this replaced.
    assert.equal(employeeInitials({ full_name: null }), "");
    assert.equal(employeeInitials({ full_name: "  " }), "");
  });
});

// ──────────────────────────────────────────────
// Date column: say which timestamp is shown
// ──────────────────────────────────────────────

describe("dateColumnLabel", () => {
  it("labels a settled row 'Paid on' and returns paid_at", () => {
    const r = dateColumnLabel({ status: "PAID", paid_at: "2026-10-01T10:00:00Z" });
    assert.equal(r.label, "Paid on");
    assert.equal(r.value, "2026-10-01T10:00:00Z");
    assert.match(r.hint, /marked paid/);
  });

  it("labels an unsettled row 'Created' and never returns a paid date", () => {
    // A pending row has no paid_at, so the old code fell back to
    // created_at and rendered it indistinguishably from a paid date.
    const r = dateColumnLabel({ status: "PENDING", paid_at: null });
    assert.equal(r.label, "Created");
    assert.equal(r.value, null);
    assert.match(r.hint, /not been paid/);
  });

  it("treats a PAID row with no paid_at as unsettled rather than blank", () => {
    const r = dateColumnLabel({ status: "PAID", paid_at: null });
    assert.equal(r.label, "Created");
    assert.equal(r.value, null);
  });

  it("does not claim a cancelled row was paid", () => {
    const r = dateColumnLabel({ status: "CANCELLED", paid_at: null });
    assert.equal(r.label, "Created");
    assert.notEqual(r.label, "Paid on");
  });

  it("always supplies a hint, because the label alone is ambiguous", () => {
    for (const status of ["PENDING", "PAID", "CANCELLED"] as const) {
      assert.ok(dateColumnLabel({ status, paid_at: null }).hint.length > 0);
    }
  });
});

// ──────────────────────────────────────────────
// Sub-line: one meaning, every screen
// ──────────────────────────────────────────────

describe("paymentSubLine", () => {
  it("names the kind and the project scope", () => {
    assert.equal(
      paymentSubLine({ kind: "TASK", label: "Homepage", project_name: "Acme" }),
      "Task · Acme"
    );
    assert.equal(
      paymentSubLine({ kind: "CUSTOM", label: "Bonus", project_name: "Acme" }),
      "Custom · Acme"
    );
  });

  it("still says something useful with no project", () => {
    assert.equal(paymentSubLine({ kind: "TASK", label: "Homepage" }), "Task payout");
    assert.equal(paymentSubLine({ kind: "CUSTOM", label: "Bonus" }), "Custom payment");
  });

  it("includes the client when present", () => {
    assert.equal(
      paymentSubLine({ kind: "TASK", label: "x", project_name: "Acme", client_name: "Globex" }),
      "Task · Acme · Globex"
    );
  });

  it("always starts with an explicit kind word, never a bare value", () => {
    for (const kind of ["TASK", "CUSTOM"] as const) {
      const line = paymentSubLine({ kind, label: "anything" });
      assert.ok(/^(Task|Custom)/.test(line), `unexpected sub-line: ${line}`);
    }
  });
});

// ──────────────────────────────────────────────
// Labels: no raw enum may reach the screen
// ──────────────────────────────────────────────

describe("enum labels are human and total", () => {
  it("covers every ledger status", () => {
    // A missing key renders as undefined in JSX — a literal "undefined"
    // in the status column. Totality is the guarantee.
    for (const s of ["PENDING", "PAID", "CANCELLED"] as const) {
      const label = LEDGER_STATUS_LABELS[s];
      assert.ok(label && label.length > 0, `${s} has no label`);
      assert.notEqual(label, s, `${s} must not render as its raw value`);
    }
  });

  it("covers every payment method", () => {
    for (const m of ["UPI", "BANK_TRANSFER", "CASH", "OTHER"] as const) {
      const label = PAYMENT_METHOD_LABELS[m];
      assert.ok(label, `${m} has no label`);
    }
    // BANK_TRANSFER and OTHER must be expanded; UPI and CASH are already
    // words a person uses, so equality with the raw value is correct there
    // and asserting otherwise would be testing the wrong thing.
    assert.equal(PAYMENT_METHOD_LABELS.BANK_TRANSFER, "Bank transfer");
    assert.notEqual(PAYMENT_METHOD_LABELS.BANK_TRANSFER, "BANK_TRANSFER");
    assert.notEqual(PAYMENT_METHOD_LABELS.OTHER, "OTHER");
  });

  it("covers every ledger payment type", () => {
    for (const t of ["TASK_PAYOUT", "CUSTOM", "BONUS", "ADJUSTMENT"] as const) {
      const label = LEDGER_PAYMENT_TYPE_LABELS[t];
      assert.ok(label, `${t} has no label`);
      assert.notEqual(label, t, `${t} must not render as its raw value`);
    }
  });

  it("keeps the task-level status map separate from the ledger one", () => {
    // tasks.payment_status has NOT_APPLICABLE; the ledger does not, and
    // the ledger has CANCELLED. Merging them is the bug migration 025
    // was written to avoid.
    assert.equal(LEDGER_STATUS_LABELS.CANCELLED, "Cancelled");
    assert.equal(
      (LEDGER_STATUS_LABELS as Record<string, string | undefined>).NOT_APPLICABLE,
      undefined
    );
  });
});

// ──────────────────────────────────────────────
// Summary windows
// ──────────────────────────────────────────────

describe("recomputeSummary window counts", () => {
  const item = (over: Partial<PaymentItem>): PaymentItem =>
    ({
      id: Math.random().toString(),
      kind: "CUSTOM",
      employee_id: "e1",
      employee_name: "Asha",
      employee_email: "asha@example.com",
      task_id: null,
      label: "x",
      project_name: null,
      client_name: null,
      amount: 100,
      base_amount: 100,
      adjustment_total: 0,
      adjustments: [],
      status: "PAID",
      paid_at: new Date().toISOString(),
      payment_note: null,
      created_at: new Date().toISOString(),
      amount_paise: 10000,
      base_amount_paise: 10000,
      type: "CUSTOM",
      method: "OTHER",
      reference_number: null,
      due_date: null,
      ...over,
    }) as PaymentItem;

  it("counts the week separately from the month and from all time", () => {
    const summary = recomputeSummary([item({})]);
    assert.equal(summary.paidThisWeekCount, 1);
    assert.equal(summary.paidThisMonthCount, 1);
    assert.equal(summary.paidTotal, 100);
    // The old caption read the all-time COUNT next to the weekly
    // AMOUNT; these must be independent numbers.
    assert.equal(summary.paidThisWeek, 100);
    assert.equal(summary.paidThisWeekCount, 1);
  });

  it("excludes a payment paid last week from this week's count", () => {
    const lastWeek = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const summary = recomputeSummary([item({ paid_at: lastWeek })]);
    assert.equal(summary.paidThisWeekCount, 0);
    assert.equal(summary.paidLastWeekCount, 1);
  });

  it("keeps cancelled money out of pending, paid and week totals", () => {
    // Cancelled is neither owed nor paid. Counting it in either would
    // misstate an employee's balance.
    const summary = recomputeSummary([
      item({ status: "CANCELLED", paid_at: null, amount: 500 }),
      item({ status: "PENDING", paid_at: null, amount: 300 }),
      item({ status: "PAID", amount: 100 }),
    ]);
    assert.equal(summary.paidTotal, 100);
    assert.equal(summary.pendingTotal, 300);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.paidCancelledTotal, 500);
    assert.equal(summary.paidCancelledCount, 1);
  });

  it("returns zeros for an empty ledger rather than undefined", () => {
    const s = recomputeSummary([]);
    assert.equal(s.paidThisWeekCount, 0);
    assert.equal(s.paidLastWeekCount, 0);
    assert.equal(s.paidCancelledCount, 0);
    assert.equal(s.paidThisWeek, 0);
  });

  it("ignores a malformed paid_at instead of producing NaN", () => {
    const s = recomputeSummary([item({ paid_at: "not-a-date" })]);
    assert.ok(Number.isFinite(s.paidTotal));
    assert.equal(s.paidThisWeekCount, 0);
  });
});

// ──────────────────────────────────────────────
// The view must not reintroduce the defects
// ──────────────────────────────────────────────

describe("admin-payments-view wiring", () => {
  const view = read("../components/payments/admin-payments-view.tsx");

  it("never captions the week card with an all-time count", () => {
    // The exact regression: `${counts.paid} payment... total` under the
    // "Paid this week" amount.
    assert.doesNotMatch(
      view,
      /label="Paid this week"[\s\S]{0,200}counts\.paid/,
      "week card must not be captioned with the all-time paid count"
    );
    assert.match(view, /summary\.paidThisWeekCount/);
  });

  it("uses the window count for the month card too", () => {
    assert.doesNotMatch(
      view,
      /label="Paid this month"[\s\S]{0,240}% of all time/,
      "month card should compare to last month, not to a share of all time"
    );
    assert.match(view, /summary\.paidThisMonthCount/);
    assert.match(view, /paidLastMonth/);
  });

  it("resolves the employee option list through the shared helper", () => {
    // The option list feeds the by-employee tab, the filter dropdown and
    // the create-payment picker. Resolving the label once here — rather
    // than at each render site — is what stops one person appearing under
    // different labels in different parts of the page.
    const match = view.match(
      /const employeeOptions = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[employeesQuery\.data/
    );
    assert.ok(match, "employeeOptions memo not found");
    assert.match(match![0], /employeeDisplayName\(\{ full_name: e\.full_name, email: e\.email \}\)/);
  });

  it("fetches employee email so the label fallback has data to work with", () => {
    // A helper that can fall back to email is useless if the query never
    // selects it. Both hops are asserted.
    const actions = read("../lib/actions/employees.ts");
    assert.match(actions, /select\("id, full_name, email, avatar_url"\)/);

    const options = read("../lib/queries/options.ts");
    assert.match(options, /full_name: string; email: string; avatar_url/);
  });

  it("routes every employee label through the shared helper", () => {
    // No raw `employee_name ?? "—"` and no role/initials fallback left.
    assert.doesNotMatch(view, /employee_name \?\? "—"/);
    assert.match(view, /employeeDisplayName/);
  });

  it("reads filter state from the URL and writes it back", () => {
    assert.match(view, /useSearchParams/);
    assert.match(view, /router\.replace\(/);
  });

  it("offers a Cancelled tab and counts it", () => {
    assert.match(view, /value="cancelled"/);
    assert.match(view, /cancelled: history\.filter/);
  });

  it("selects only PENDING rows for bulk actions", () => {
    assert.match(view, /const isBulkable = p\.status === "PENDING"/);
    assert.match(
      view,
      /selectableIds[\s\S]{0,160}status === "PENDING"/
    );
  });
});

describe("payments page Suspense boundary", () => {
  const page = read("../app/(dashboard)/payments/page.tsx");

  it("wraps the URL-driven view in Suspense", () => {
    // useSearchParams without a boundary fails the production build.
    assert.match(page, /<Suspense/);
    assert.match(page, /AdminPaymentsView/);
  });
});