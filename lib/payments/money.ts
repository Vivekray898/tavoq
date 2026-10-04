// lib/payments/money.ts
//
// Money for the payment ledger (Phase 4A).
//
// The ledger stores `amount_paise BIGINT` — integer paise, i.e. rupees
// × 100. Float rupees are what the old `payments.amount NUMERIC(10,2)`
// column used, and NUMERIC-to-float conversion in JavaScript is exactly
// where payroll totals drift: 0.1 + 0.2 !== 0.3, and a thousand rows
// of 19.99 can sum to something visibly wrong. Paise move that boundary
// into the database, where they are exact.
//
// This module is deliberately pure and dependency-free so it can be unit
// tested — it is imported by both "use server" actions and client
// components, and the node test runner cannot import a "use server" file.
//
// Two representations, one direction of travel:
//   • rupees (what a person types) → toPaise() → paise (what is stored)
//   • paise (what is stored)       → formatMoney() → rupees (displayed)
//
// paise is the source of truth. formatCurrency() in lib/utils.ts stays
// for the task-level `payout_amount` (a NUMERIC), which predates the
// ledger and is not migrated in this phase.

/** Integer paise. 100 paise = ₹1. */
export type Paise = number;

/** One rupee expressed in paise. */
export const PAISE_PER_RUPEE = 100;

/**
 * Convert a rupee amount to integer paise.
 *
 * Rounding is half-up on the absolute value, so -0.005 rounds away from
 * zero in both directions. Math.round alone would round -0.5 toward zero
 * (JS gives Math.round(-0.5) === -0), which would make a negative
 * deduction of half a paise flip sign relative to a positive one of the
 * same magnitude — a rounding bug that would only show up on employee
 * statements.
 *
 * Non-finite input yields 0 rather than NaN: every caller is rendering or
 * storing a payment, and "₹NaN" in a payroll total is worse than a
 * missing amount.
 */
export function toPaise(rupees: number | string | null | undefined): Paise {
  const value = typeof rupees === "string" ? Number(rupees) : rupees;
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  const scaled = value * PAISE_PER_RUPEE;
  // `Math.sign(0) === 0`, so a zero input stays zero without a special case.
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  // Guard against exceeding the safe-integer range: a value that large is
  // a data error, and silently wrapping to a wrong integer is worse than
  // clamping to zero and letting the DB CHECK reject it.
  if (!Number.isSafeInteger(rounded)) return 0;
  return rounded;
}

/**
 * Convert paise back to a rupee number. Only for interop with APIs that
 * still speak floats (e.g. the Resend email templates) — never for
 * accumulating a total.
 */
export function toRupees(paise: Paise | null | undefined): number {
  const value = Number(paise ?? 0);
  if (!Number.isFinite(value)) return 0;
  return value / PAISE_PER_RUPEE;
}

/**
 * Format paise as INR with Indian digit grouping → "₹1,250.00",
 * "₹12,34,567.89".
 *
 * `en-IN` applies the lakh/crore grouping Indian users expect, which is
 * what makes ₹100000 read as ₹1,00,000 rather than ₹100,000. The two
 * trailing decimals are always shown even for whole rupees: a payroll
 * ledger that renders "₹50" for one row and "₹1,250.00" for another is
 * ambiguous at a glance, and alignment in the table matters more than
 * saving a character.
 *
 * Negative amounts are legitimate — they are deductions (§19). They are
 * rendered as "-₹500.00" so the sign stays visible next to the symbol.
 */
export function formatMoney(
  paise: Paise | null | undefined,
  currency = "INR"
): string {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  const value = Number(paise ?? 0);
  if (!Number.isFinite(value)) return `${symbol}0.00`;
  const sign = value < 0 ? "-" : "";
  return `${sign}${symbol}${Math.abs(value / PAISE_PER_RUPEE).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Parse a value typed into a rupee amount input.
 *
 * Accepts the shapes a person actually types — "1250", "1,250.50",
 * "₹1250" — and returns null for anything else so the caller can show a
 * field error. Number("") is 0 and Number("1,250") is NaN, so neither can
 * be trusted to go straight into toPaise().
 */
export function parseRupeeInput(input: string | null | undefined): Paise | null {
  if (input === null || input === undefined) return null;
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return toPaise(value);
}