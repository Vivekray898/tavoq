// lib/payments/display.ts
//
// Presentation helpers for the payments UI. Pure and dependency-free so
// they can be unit tested — the views that use them are client
// components and the page is assembled from many call sites, so the
// rules have to live in one place rather than be re-derived per screen.

/**
 * The label a person is shown by, everywhere in the payments UI.
 *
 * The precedence rule is the point of this function:
 *
 *   full name  →  email local-part  →  "Unassigned"
 *
 * and, crucially, **never the role string and never initials**.
 *
 * Why that matters: an earlier build fell back to the role when no name
 * was set, so an employee with no `full_name` rendered as the literal
 * word "EMPLOYEE" in the employee column — indistinguishable from a
 * column of job titles, and completely useless for telling two people
 * apart. A separate path derived initials ("B.P."), so the *same person
 * appeared under two different labels* depending on which screen you
 * were on. Neither is a name.
 *
 * Email beats the role because it is the one identifier guaranteed to be
 * unique per person and already known to the user; it degrades to
 * something recognisable rather than something ambiguous. Roles are a
 * permission concept and have no business in a payroll list.
 *
 * "Unassigned" is reserved for rows with no employee at all, so it never
 * competes with a real person's label.
 */
export function employeeDisplayName(
  person:
    | {
        full_name?: string | null;
        email?: string | null;
      }
    | null
    | undefined
): string {
  if (!person) return "Unassigned";
  const name = person.full_name?.trim();
  if (name) return name;
  const email = person.email?.trim();
  if (email) return emailLocalPart(email);
  return "Unassigned";
}

/**
 * The part of an email before the "@", tidied for display.
 *
 * Dots and underscores become spaces and are title-cased, because
 * "priya.sharma" and "Priya Sharma" should not read as two different
 * people in the same list. An email with no usable local part (e.g.
 * "@example.com") returns "" so the caller falls through to Unassigned.
 */
export function emailLocalPart(email: string): string {
  // `at === -1` means there is no "@" at all, so the whole string is the
  // local part. A leading "@" means an EMPTY local part — using `at > 0`
  // there would treat "@example.com" as the name "@example Com".
  const at = email.indexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  const cleaned = local.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Two-letter monogram for the avatar, from the same label the row shows.
 *
 * Derived from `employeeDisplayName` so the avatar and the text beside it
 * can never disagree. Returns "" when there is no real name, which the
 * avatar component renders as its neutral placeholder rather than as
 * invented initials.
 */
export function employeeInitials(person: { full_name?: string | null }): string {
  const name = person.full_name?.trim();
  if (!name) return "";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Sub-line under a payment title.
 *
 * The table previously showed `description` for custom payments and the
 * task title for task payouts with no indication of which was which, so a
 * grey line under a row could mean either. Returns an explicit prefix so
 * the same line always reads the same way on desktop and mobile.
 *
 * Returns "" when there is nothing to say — an empty grey line is worse
 * than no line.
 */
export function paymentSubLine(payment: {
  kind: "TASK" | "CUSTOM";
  label: string;
  project_name?: string | null;
  client_name?: string | null;
}): string {
  const scope = [payment.project_name, payment.client_name].filter(Boolean).join(" · ");
  if (payment.kind === "TASK") return scope ? `Task · ${scope}` : "Task payout";
  // For a custom payment `label` IS the description, so naming it
  // "Custom payment" when there is no scope keeps the line informative.
  return scope ? `Custom · ${scope}` : "Custom payment";
}

/**
 * Human label for the date cell, matching which timestamp it shows.
 *
 * The column previously showed a date with no indication of what it
 * meant: a pending row has no paid date, so it fell back to created_at
 * and rendered identically to a settled row. The label is part of the
 * cell, not a tooltip-only hint, because the tooltip is unavailable on
 * touch and to screen readers.
 */
export function dateColumnLabel(payment: {
  status: "PENDING" | "PAID" | "CANCELLED";
  paid_at?: string | null;
}): { label: "Paid on" | "Created"; value: string | null; hint: string } {
  if (payment.status === "PAID" && payment.paid_at) {
    return {
      label: "Paid on",
      value: payment.paid_at,
      hint: "The date this payment was marked paid.",
    };
  }
  return {
    label: "Created",
    value: null,
    hint: "The date this payment was recorded. It has not been paid yet.",
  };
}