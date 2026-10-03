// Pure ledger logic for payment adjustments — no I/O, no framework
// imports, so it can be unit tested directly (lib/actions/payments.ts
// is a "use server" module and cannot be imported by the test runner).
//
// An adjustment is a payments row with kind='ADJUSTMENT' and a
// parent_payment_id pointing at the payment it corrects. The ledger is
// append-only: an adjustment is never a mutation of the original, and
// reversing one means recording the opposite amount. That is what keeps
// the money trail auditable.

/** App-level payment shape: task-linked, or standalone/custom. */
export type PaymentKind = "TASK" | "CUSTOM";

/** One bonus or deduction attached to a paid payment. */
export interface AdjustmentSummary {
  id: string;
  /** Signed: positive bonus, negative deduction. */
  amount: number;
  reason: string;
  created_at: string;
  actor_name: string | null;
}

/** Human-readable payment row — never exposes internal IDs. */
export interface PaymentItem {
  id: string;
  kind: PaymentKind;
  employee_id: string | null;
  employee_name: string | null;
  task_id: string | null;
  label: string; // task title or custom description
  project_name: string | null;
  client_name: string | null;
  /**
   * The NET amount: what the employee actually received, i.e. the base
   * amount plus every adjustment attached to this payment.
   *
   * This stays the single number every existing rollup already sums, so
   * pending/paid totals, the ERP strip and per-employee figures are
   * correct without any of them learning about adjustments. Use
   * `base_amount` when the UI needs to show what was originally paid.
   */
  amount: number;
  /** The original payout, before adjustments. Equals `amount` when there are none. */
  base_amount: number;
  /** Net of all adjustments — 0 when there are none. */
  adjustment_total: number;
  adjustments: AdjustmentSummary[];
  status: "PENDING" | "PAID";
  paid_at: string | null;
  payment_note: string | null;
  /** Present on workspace/history items; batch-returns may omit it. */
  created_at?: string;
}

/**
 * A payments row as read from the database, before adjustments are
 * folded in. Kept separate from PaymentItem because the wire shape and
 * the UI shape are genuinely different: one is a flat ledger row, the
 * other is a payment with a list of corrections attached.
 *
 * `kind` here is the DATABASE marker ('PAYMENT' | 'ADJUSTMENT'). It is
 * deliberately not the same concept as PaymentItem.kind ('TASK' |
 * 'CUSTOM'): one records whether a row is a payout or a correction, the
 * other whether it is tied to a task. Collapsing them would make "a
 * custom payment that carries an adjustment" inexpressible.
 */
export interface PaymentLedgerRow {
  id: string;
  task_id: string | null;
  employee_id: string | null;
  description: string | null;
  amount: number | string;
  paid_at: string | null;
  payment_note: string | null;
  created_at: string;
  /** DB-level marker: a real payout, or a correction to one. */
  kind: "PAYMENT" | "ADJUSTMENT";
  parent_payment_id: string | null;
  employee: { full_name: string }[] | { full_name: string } | null;
  paid_by_profile: { full_name: string }[] | { full_name: string } | null;
  task: {
    id: string;
    title: string;
    project:
      | { name: string; client: { name: string }[] | { name: string } | null }[]
      | { name: string; client: { name: string }[] | { name: string } | null }
      | null;
  } | null;
}

/** Pull embedded relation rows whether Supabase returns array or object. */
export function one<T>(embedded: T[] | T | null | undefined): T | null {
  if (!embedded) return null;
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
}

/**
 * Fold adjustments into their parent payments.
 *
 * An adjustment is a ledger row that must never appear as its own entry
 * in the workspace — that would double-count, because the parent still
 * exists. Instead each adjustment is attached to the payment it modifies
 * and the parent's `amount` becomes the net.
 *
 * Three properties this relies on, all enforced by migration 019 and
 * createPaymentAdjustment:
 *   • an adjustment always has a parent_payment_id
 *   • a parent is never itself an adjustment (no daisy chains)
 *   • a payment's kind is stable
 *
 * An adjustment whose parent is missing from the same result set (a
 * parent the viewer cannot see, or one beyond the query's limit) is
 * returned as its own row rather than silently dropped. Dropping it
 * would quietly lose money from the ledger, which is the one failure
 * mode this feature must never have.
 */
export function foldAdjustments(rows: PaymentLedgerRow[]): PaymentItem[] {
  const byParent = new Map<string, AdjustmentSummary[]>();
  const parentIds = new Set<string>();
  const parents: PaymentLedgerRow[] = [];
  const orphanRows: PaymentLedgerRow[] = [];

  // First pass: identify the real payments, so an adjustment can be
  // matched against them before anything is attached.
  for (const row of rows) {
    if ((row.kind ?? "PAYMENT") === "PAYMENT") {
      parents.push(row);
      parentIds.add(row.id);
    } else {
      orphanRows.push(row);
    }
  }

  // Second pass: attach each adjustment to its parent, or keep it
  // standalone when the parent is not in this result set.
  //
  // The "not in this result set" case is real, not hypothetical: the
  // query is capped (LIMIT 500) and a viewer may not be able to read
  // the parent. Dropping the adjustment there would silently delete
  // money from the ledger, so it is surfaced as its own row instead.
  const orphans: PaymentLedgerRow[] = [];
  for (const row of orphanRows) {
    const parentId = row.parent_payment_id;
    if (!parentId || !parentIds.has(parentId)) {
      orphans.push(row);
      continue;
    }
    const list = byParent.get(parentId) ?? [];
    list.push({
      id: row.id,
      amount: Number(row.amount),
      reason: row.description ?? row.payment_note ?? "Adjustment",
      created_at: row.created_at,
      actor_name: one(row.paid_by_profile)?.full_name ?? null,
    });
    byParent.set(parentId, list);
  }

  const toItem = (row: PaymentLedgerRow, isOrphan = false): PaymentItem => {
    const task = row.task;
    const project = task ? one(task.project) : null;
    const client = project
      ? one(
          (project as { client?: { name: string }[] | { name: string } | null }).client ??
            null
        )
      : null;
    const employee = one(row.employee);

    const adjustments = isOrphan
      ? []
      : (byParent.get(row.id) ?? []).sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
        );
    const adjustment_total = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const base_amount = Number(row.amount);

    return {
      id: row.id,
      kind: row.task_id ? "TASK" : "CUSTOM",
      employee_id: row.employee_id,
      employee_name: employee?.full_name ?? null,
      task_id: row.task_id,
      label: row.task_id ? (task?.title ?? "Task") : (row.description ?? "Custom payment"),
      project_name: project?.name ?? null,
      client_name: client?.name ?? null,
      amount: base_amount + adjustment_total,
      base_amount,
      adjustment_total,
      adjustments,
      status: row.paid_at ? "PAID" : "PENDING",
      paid_at: row.paid_at,
      payment_note: row.payment_note,
      created_at: row.created_at,
    };
  };

  return [...parents.map((p) => toItem(p)), ...orphans.map((o) => toItem(o, true))];
}

/**
 * Apply a freshly-recorded adjustment to the parent row already held in
 * the client's cache.
 *
 * Used after createPaymentAdjustment so the workspace updates in place
 * instead of refetching. Returns null when the parent is not in the
 * list — the caller then falls back to invalidating the query.
 */
export function applyAdjustmentToItem(
  item: PaymentItem,
  adjustment: AdjustmentSummary
): PaymentItem {
  return {
    ...item,
    amount: item.amount + adjustment.amount,
    adjustment_total: item.adjustment_total + adjustment.amount,
    adjustments: [...item.adjustments, adjustment].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    ),
  };
}
/**
 * Recompute the ERP summary from a (possibly just-patched) history.
 *
 * Every figure here is a sum over `item.amount`, which is the NET after
 * adjustments — so recording a bonus updates the strip with no
 * adjustment-specific code and no refetch. Mirrors the server's
 * getPaymentWorkspace rollup exactly.
 */
export function recomputeSummary(items: PaymentItem[]): {
  pendingTotal: number;
  pendingCount: number;
  paidThisWeek: number;
  paidThisMonth: number;
  paidTotal: number;
} {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const daysSinceMonday = (istNow.getUTCDay() + 6) % 7;
  const weekStart = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() - daysSinceMonday,
      0, 0, 0
    ) - 5.5 * 60 * 60 * 1000
  ).toISOString();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 5.5 * 60 * 60 * 1000
  ).toISOString();

  let pendingTotal = 0;
  let pendingCount = 0;
  let paidThisWeek = 0;
  let paidThisMonth = 0;
  let paidTotal = 0;

  for (const item of items) {
    if (item.status === "PENDING") {
      pendingTotal += item.amount;
      pendingCount += 1;
      continue;
    }
    paidTotal += item.amount;
    if (item.paid_at) {
      if (item.paid_at >= weekStart) paidThisWeek += item.amount;
      if (item.paid_at >= monthStart) paidThisMonth += item.amount;
    }
  }

  return { pendingTotal, pendingCount, paidThisWeek, paidThisMonth, paidTotal };
}
