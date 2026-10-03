-- ============================================================
-- Taskora — Migration 019
-- Payment adjustments: bonuses and deductions attached to an
-- existing task payment.
--
-- A payment row already has (task_id, employee_id, amount,
-- paid_at). To record an adjustment we add another payment row
-- with the same task_id and employee_id, a signed amount, and
-- the `kind` marker 'ADJUSTMENT'. `payments.amount` stays
-- NUMERIC and can already hold negatives — no schema change
-- needed for the value itself.
--
-- Two things are added:
--   1. `kind` column on payments, defaulting to the current
--      behaviour (normal payment or adjustment).
--   2. `parent_payment_id` on payments, so an adjustment points
--      at the payment it modifies.
--
-- This keeps the ledger append-only: an adjustment is a new row,
-- never a mutation of the original. Reversal is a second
-- adjustment that cancels the first.
--
-- NOTE ON NAMING
-- The `kind` column here is 'PAYMENT' | 'ADJUSTMENT' — it records
-- whether a row is a real payout or a correction to one. It is NOT
-- the application-level "TASK" | "CUSTOM" split on PaymentItem,
-- which is derived from whether task_id is set. Keeping both is
-- deliberate: they answer different questions, and conflating them
-- would make "a custom payment that is an adjustment" impossible to
-- express.
--
-- Idempotent. Run AFTER 018.
-- ============================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'PAYMENT';

-- Enforce the small set of allowed kinds without a new enum (so a
-- future kind does not require an ALTER TYPE outside a migration).
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_kind_check
  CHECK (kind IN ('PAYMENT', 'ADJUSTMENT'));

-- The payment this adjustment modifies. NULL for normal payments
-- and for standalone custom payments.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS parent_payment_id UUID
    REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_parent
  ON public.payments(parent_payment_id)
  WHERE parent_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_task_kind
  ON public.payments(task_id, kind)
  WHERE task_id IS NOT NULL;

-- Existing rows are all normal payments. The column is NOT NULL with
-- a DEFAULT, so this is belt-and-braces for rows written before the
-- default existed.
UPDATE public.payments SET kind = 'PAYMENT' WHERE kind IS NULL;

-- An adjustment always points at a payment it modifies, and never at
-- itself. Enforced here rather than only in the action so a bad write
-- from any client (including the service role) cannot create a daisy
-- chain or a self-reference.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_adjustment_parent_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_adjustment_parent_check
  CHECK (
    (kind = 'PAYMENT' AND parent_payment_id IS NULL)
    OR
    (kind = 'ADJUSTMENT' AND parent_payment_id IS NOT NULL AND parent_payment_id <> id)
  );

-- No RLS change needed. The existing "Active staff manages payments"
-- policy (migration 014) is FOR ALL USING (is_active_staff()), so it
-- covers INSERT/UPDATE/DELETE of the new rows automatically.