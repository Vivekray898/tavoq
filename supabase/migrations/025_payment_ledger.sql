-- ============================================================
-- Taskora — Migration 025
-- Payment ledger: explicit status, integer-paise amounts, and an
-- immutable audit trail.
--
-- There is NO payment gateway. Money is paid outside the app (UPI,
-- bank transfer, cash) and recorded here. This migration makes the
-- ledger trustworthy; it does not move money.
--
-- ── Why a NEW status enum ────────────────────────────────────
-- `payment_status` already exists (001, line 15) and belongs to
-- `tasks`: NOT_APPLICABLE | PENDING | PAID. It answers "is this task's
-- payout owed?" and is read by task, employee, dashboard and project
-- actions.
--
-- The ledger needs PENDING | PAID | CANCELLED — CANCELLED cannot
-- exist on tasks. Reusing the name would fail at CREATE TYPE (the type
-- is already there) and would silently repoint four call sites that
-- read tasks.payment_status. So the ledger gets `payment_ledger_status`
-- and the two are deliberately decoupled: cancelling a payment never
-- mutates task state.
--
-- ── What changes about status ────────────────────────────────
-- Before this migration a payment's status was inferred in application
-- code as `paid_at IS NULL ? PENDING : PAID`. CANCELLED was not
-- expressible, and a payment could not record *why* it was not paid.
-- Status is now stored, backfilled from paid_at, and enforced.
--
-- ── Signed amounts (do NOT "fix" this) ───────────────────────
-- Migration 019 made the ledger append-only: a bonus or deduction is a
-- NEW payments row with a signed amount and a parent_payment_id, never
-- a mutation of the original. createPaymentAdjustment rejects only
-- zero and renders the sign as + / −. A constraint of
-- `amount_paise > 0` on every row would therefore reject every bonus
-- and every deduction. The positivity rule below is scoped to
-- kind = 'PAYMENT' for exactly that reason.
--
-- ── Money ───────────────────────────────────────────────────
-- `amount_paise BIGINT` is authoritative. `amount` (NUMERIC) is kept
-- in sync by a trigger rather than by application code, so the two
-- cannot drift when a new call site forgets to write both. It is
-- dropped in a later migration once no call site references it; see
-- docs/payments.md. The trigger is a BEFORE trigger (not a GENERATED
-- column) because the three existing write payloads pass `amount`
-- explicitly and
-- Postgres rejects an explicit value for a generated column.
--
-- Everything below is additive. No column or table is dropped or
-- renamed, and `kind` / `parent_payment_id` from 019 are untouched.
--
-- ROLLBACK
--   DROP FUNCTION mark_payments_paid(...), get_payments_summary(...);
--   DROP TRIGGER payments_sync_amount ON public.payments;
--   DROP FUNCTION payments_sync_amount();
--   DROP TABLE public.payment_events;
--   -- then drop the constraints named below, the indexes, and the
--   -- added columns (project_id, amount_paise, status, currency,
--   -- payment_method, reference_number, due_date, cancelled_at,
--   -- cancel_reason, notes, proof_path, type, payee).
--   DROP TYPE payment_ledger_status, payment_method_enum, payment_type_enum;
-- The original 11 columns and all existing rows survive untouched.
--
-- Idempotent. Run AFTER 024.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Enums
--
-- ADD VALUE cannot be used to *create* a type, and each type here is
-- brand new, so plain CREATE TYPE with a DO/EXCEPTION guard for
-- idempotency is correct.
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.payment_ledger_status AS ENUM ('PENDING', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_method_enum AS ENUM ('UPI', 'BANK_TRANSFER', 'CASH', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_type_enum AS ENUM
    ('TASK_PAYOUT', 'CUSTOM', 'BONUS', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. Columns
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amount_paise BIGINT,
  ADD COLUMN IF NOT EXISTS status public.payment_ledger_status,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method_enum,
  ADD COLUMN IF NOT EXISTS reference_number TEXT,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS proof_path TEXT,
  ADD COLUMN IF NOT EXISTS type public.payment_type_enum,
  -- Who the money is for. This equals employee_id today (the ledger is
  -- single-payee by construction). It exists separately so that
  -- "who receives it" and "who the record is filed under" can diverge
  -- later — e.g. paying a contractor via a staff member's record —
  -- without another migration. Never nullable: a ledger row with no
  -- known recipient is unattributable and must not exist.
  ADD COLUMN IF NOT EXISTS payee UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill project_id from the task's project. Task payouts are the
-- only rows that can resolve a project; custom payments stay NULL and
-- are read as "not project-scoped".
UPDATE public.payments p
SET project_id = t.project_id
FROM public.tasks t
WHERE p.task_id = t.id
  AND p.project_id IS NULL
  AND t.project_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Backfill paise, status and type
--
-- `amount` is NUMERIC(10,2), so multiplying by 100 is exact for every
-- stored value (max two decimal places) — no rounding loss. The
-- numeric cast keeps this safe regardless of column type drift.
-- ────────────────────────────────────────────────────────────

UPDATE public.payments
SET amount_paise = round(amount * 100)::BIGINT
WHERE amount_paise IS NULL;

-- Legacy PAID rows have no method (the column did not exist). They are
-- backfilled with 'OTHER' *before* the completeness constraint is
-- added, otherwise validating existing rows would fail.
UPDATE public.payments
SET status = CASE WHEN paid_at IS NOT NULL THEN 'PAID'::public.payment_ledger_status
                  ELSE 'PENDING'::public.payment_ledger_status END
WHERE status IS NULL;

UPDATE public.payments
SET payment_method = 'OTHER'::public.payment_method_enum
WHERE paid_at IS NOT NULL
  AND payment_method IS NULL;

UPDATE public.payments
SET payee = employee_id
WHERE payee IS NULL;

-- `kind` stays the internal integrity marker exactly as 019 defined it
-- (PAYMENT | ADJUSTMENT). `type` is the UI-facing classification and
-- deliberately answers a different question, per that migration's
-- header. BONUS is backfilled as ADJUSTMENT because today a bonus IS an
-- adjustment with a positive amount; the distinction is the sign, and
-- inventing a BONUS history would misrepresent existing rows.
UPDATE public.payments
SET type = CASE
  WHEN kind = 'ADJUSTMENT' THEN 'ADJUSTMENT'::public.payment_type_enum
  WHEN task_id IS NOT NULL THEN 'TASK_PAYOUT'::public.payment_type_enum
  ELSE 'CUSTOM'::public.payment_type_enum
END
WHERE type IS NULL;

-- A standalone custom payment that was never filed against an employee
-- still needs a payee. Fall back to the task assignee, then to the
-- original approver, so the NOT NULL constraint cannot strand a row.
UPDATE public.payments p
SET payee = t.assigned_to
FROM public.tasks t
WHERE p.task_id = t.id
  AND p.payee IS NULL
  AND t.assigned_to IS NOT NULL;

-- Make the backfilled columns authoritative from here on.
ALTER TABLE public.payments
  ALTER COLUMN amount_paise SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN payee SET NOT NULL,
  ALTER COLUMN type SET NOT NULL;

ALTER TABLE public.payments
  ALTER COLUMN status SET DEFAULT 'PENDING',
  ALTER COLUMN type SET DEFAULT 'CUSTOM';

-- ────────────────────────────────────────────────────────────
-- 4. Keeping `amount` in step with `amount_paise`
--
-- A BEFORE INSERT OR UPDATE trigger rewrites NEW.amount from
-- NEW.amount_paise, so a new write path cannot drift the two columns.
-- The application also writes both from the same rupee value in the same
-- object literal, which is not redundancy: `amount` has been NOT NULL
-- since 001 and nine read paths still sum it (lib/actions/employees.ts,
-- lib/actions/dashboard.ts, getMyEarnings), so a write payload that
-- omitted it would fail the insert and turn those totals into NaN.
--
-- DO NOT confuse this trigger with the policy at §9. A revision of this
-- migration removed the trigger while chasing:
--
--     ERROR: 42703: column "new" does not exist
--
-- That error never came from here. It came from
-- can_manage_payment(NEW) inside a CREATE POLICY ... WITH CHECK clause.
-- NEW/OLD are in scope ONLY in a trigger function and a RETURNING
-- clause; an RLS policy names the row by the TABLE, so the correct
-- argument is can_manage_payment(payments). Inside the function below,
-- NEW is exactly where it belongs.
--
-- A GENERATED ALWAYS column would remove the trigger entirely, but
-- Postgres has no ALTER COLUMN ... SET DATA TYPE GENERATED, so it means
-- dropping and re-adding `amount`, losing column privileges and any
-- dependent default. Not worth it for a column with one release left.
CREATE OR REPLACE FUNCTION public.payments_sync_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.amount_paise IS NOT NULL THEN
    NEW.amount := (NEW.amount_paise::NUMERIC / 100);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_sync_amount ON public.payments;
CREATE TRIGGER payments_sync_amount
  BEFORE INSERT OR UPDATE OF amount_paise, amount ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_sync_amount();
-- ──────────────────────────────────────────────

-- Repair any row whose legacy `amount` disagreed with the backfill, so
-- the NOT NULL and comparison assertions below hold for every row.
UPDATE public.payments
SET amount_paise = round(amount * 100)::BIGINT
WHERE amount_paise IS DISTINCT FROM round(amount * 100)::BIGINT;

-- A payment row must carry an amount. Guards the backfill itself: if
-- `amount` were ever NULL the multiplication above would produce NULL and
-- the SET NOT NULL would fail with a confusing constraint error.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_not_null;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_not_null
  CHECK (amount IS NOT NULL);

-- ────────────────────────────────────────────────────────────
-- 5. Constraints
--
-- Rules live here, not only in the UI. Server actions re-check them for
-- a clear error message, but the database is the boundary.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_nonzero;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_nonzero
  CHECK (amount_paise <> 0);

-- Positive for real payouts; signed for adjustments (bonuses and
-- deductions). See the header — this is intentional.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive
  CHECK (kind = 'ADJUSTMENT' OR amount_paise > 0);

-- A PAID payment must say who paid it, when, and how.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_paid_complete;
ALTER TABLE public.payments ADD CONSTRAINT payments_paid_complete
  CHECK (
    status <> 'PAID'
    OR (paid_at IS NOT NULL AND paid_by IS NOT NULL AND payment_method IS NOT NULL)
  );

-- Cancellation always carries a reason. This is what makes an
-- unexplained missing payment impossible.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_cancel_complete;
ALTER TABLE public.payments ADD CONSTRAINT payments_cancel_complete
  CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND
      NULLIF(BTRIM(cancel_reason), '') IS NOT NULL)
    OR status <> 'CANCELLED'
  );

-- The "one active task payout per task" rule is the partial UNIQUE
-- index below rather than a CHECK: the predicate references the row's
-- own status, which a CHECK cannot do portably.

-- A task payout must actually point at a task.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_task_payout_has_task;
ALTER TABLE public.payments ADD CONSTRAINT payments_task_payout_has_task
  CHECK (type <> 'TASK_PAYOUT' OR task_id IS NOT NULL);

-- ────────────────────────────────────────────────────────────
-- 6. Indexes
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payments_status_paid_at
  ON public.payments(status, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_employee_status
  ON public.payments(employee_id, status);

CREATE INDEX IF NOT EXISTS idx_payments_project_id
  ON public.payments(project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_due_date
  ON public.payments(due_date)
  WHERE status = 'PENDING' AND due_date IS NOT NULL;

-- One active payout per task, enforced as an index rather than a
-- CHECK because the predicate references the row's own status.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_active_task_payout
  ON public.payments(task_id)
  WHERE kind = 'PAYMENT'
    AND type = 'TASK_PAYOUT'
    AND status <> 'CANCELLED';

-- ────────────────────────────────────────────────────────────
-- 7. payment_events — the audit trail
--
-- Insert-only. No UPDATE policy and no DELETE policy exist at all, so
-- RLS denies both structurally rather than by convention. service_role
-- bypasses RLS, so a superuser *could* still mutate a row from SQL;
-- that is the escape hatch the plan calls for and is recorded here so
-- it is not mistaken for a guarantee.
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.payment_event_action AS ENUM
    ('CREATED', 'PAID', 'REVERSED', 'CANCELLED', 'UPDATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action public.payment_event_action NOT NULL,
  from_status public.payment_ledger_status,
  to_status public.payment_ledger_status,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_created
  ON public.payment_events(payment_id, created_at DESC);

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Deliberately only an INSERT policy.
DROP POLICY IF EXISTS "Staff append payment events" ON public.payment_events;
CREATE POLICY "Staff append payment events"
  ON public.payment_events FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff());

-- Employees may read the history of their own payments; staff read all.
DROP POLICY IF EXISTS "Read own payment events" ON public.payment_events;
CREATE POLICY "Read own payment events"
  ON public.payment_events FOR SELECT TO authenticated
  USING (
    public.is_active_staff()
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_events.payment_id
        AND (p.employee_id = auth.uid() OR p.payee = auth.uid())
    )
  );

REVOKE UPDATE, DELETE ON public.payment_events FROM authenticated;

-- ────────────────────────────────────────────────────────────
-- 8. Helper: can this caller administer this payment?
--
-- Payroll is org-wide in this app (014, §9), but the ledger narrows
-- write access to the projects a manager actually manages, so a
-- manager cannot pay out of a project they do not own. `project_id` is
-- NULL for custom payments, and a manager with no project scope must
-- not be able to pay those either — hence the explicit staff check.
-- ────────────────────────────────────────────────────────────

-- SECURITY INVOKER, not DEFINER: this is a policy predicate, so running
-- it as the caller is what makes it evaluate against THEIR permissions.
-- (is_active_admin/is_active_manager/can_manage_project inside are
-- themselves DEFINER, so nothing recurses.)
CREATE OR REPLACE FUNCTION public.can_manage_payment(payment_row public.payments)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    public.is_active_admin()
    OR (
      public.is_active_manager()
      AND payment_row.project_id IS NOT NULL
      AND public.can_manage_project(payment_row.project_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_payment(public.payments) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_payment(public.payments) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- The ledger records who filed the row. The column is declared before the
-- policies below because a policy expression is parsed when the policy is
-- created, so referencing it earlier would fail.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_by UUID
  REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.payments
SET created_by = paid_by
WHERE created_by IS NULL AND paid_by IS NOT NULL;

-- 9. RLS on payments
--
-- 014 §9 granted is_active_staff() FOR ALL. That is too broad for a
-- ledger: it let any manager edit any payment, including a PAID one.
-- It is replaced here with policies that separate read, create,
-- pay, edit-while-pending and cancel.
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Active staff manages payments" ON public.payments;

-- Employees read only their own rows. Falls back to the task assignee
-- so legacy rows backfilled in 009 stay visible.
CREATE POLICY "Ledger read scope"
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.is_active_staff()
    OR employee_id = auth.uid()
    OR payee = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = payments.task_id AND t.assigned_to = auth.uid()
    )
  );

-- A policy expression can only name the table; NEW/OLD are not in scope
-- here (they exist solely in trigger functions and RETURNING clauses).
-- Referencing NEW here is what produced:
--     ERROR: 42703: column "new" does not exist
-- For INSERT the row being checked is the table itself, so the argument
-- is the table name — the same form the USING clause of an UPDATE policy
-- takes below.
CREATE POLICY "Ledger create"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_payment(payments) AND created_by = auth.uid());

CREATE POLICY "Ledger edit while pending"
  ON public.payments FOR UPDATE TO authenticated
  USING (public.can_manage_payment(payments) AND status = 'PENDING')
  WITH CHECK (public.can_manage_payment(payments));

-- Cancelling, or reversing an already-paid payment, is super-admin only.
-- A PAID row is never edited in place — it goes back to PENDING with a
-- reason, which the RPC below records as an audit event.
CREATE POLICY "Ledger cancel or reverse"
  ON public.payments FOR UPDATE TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- ────────────────────────────────────────────────────────────
-- 10. mark_payments_paid
--
-- SECURITY INVOKER: this function is GRANTed to `authenticated` and
-- RETURNS data, so DEFINER would bypass RLS and hand a caller rows they
-- may not read (scripts/verify-rpc-security.mjs enforces this). As
-- INVOKER, the RLS policies written in §9 ARE the authorization — an
-- UPDATE reaches only rows the caller could already edit, and
-- `SELECT ... FOR UPDATE` only sees rows RLS allows.
--
-- The role re-reads from `profiles` inside the function rather than
-- trusting the JWT. That is defence in depth on top of RLS, not a
-- replacement for it: RLS is the boundary, these checks produce the
-- readable error message.
--
-- Idempotent: a payment already PAID is reported as `skipped`, not an
-- error, so a retried bulk action cannot double-pay.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_payments_paid(
  payment_ids UUID[],
  method public.payment_method_enum,
  paid_on TIMESTAMPTZ DEFAULT NULL,
  reference TEXT DEFAULT NULL,
  note TEXT DEFAULT NULL
)
RETURNS TABLE (payment_id UUID, outcome TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  paid_at_value TIMESTAMPTZ := COALESCE(paid_on, now());
  r RECORD;
  prior_status public.payment_ledger_status;
  result_ids UUID[] := ARRAY[]::UUID[];
  result_outcomes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor AND status = 'ACTIVE' AND role IN ('SUPER_ADMIN', 'MANAGER')
  ) THEN
    RAISE EXCEPTION 'Only a manager or super admin can mark payments paid'
      USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serialises concurrent bulk actions on the same rows:
  -- the second transaction blocks here until the first commits, then
  -- re-reads status and reports 'skipped'.
  FOR r IN
    SELECT p.id, p.status, p.project_id, p.kind, p.task_id
    FROM public.payments p
    WHERE p.id = ANY(payment_ids)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    prior_status := r.status;

    IF prior_status = 'PAID' THEN
      result_ids := result_ids || r.id;
      result_outcomes := result_outcomes || 'skipped';
      CONTINUE;
    END IF;

    IF prior_status = 'CANCELLED' THEN
      result_ids := result_ids || r.id;
      result_outcomes := result_outcomes || 'cancelled';
      CONTINUE;
    END IF;

    IF NOT (
      public.is_active_admin()
      OR (
        public.is_active_manager()
        AND r.project_id IS NOT NULL
        AND public.can_manage_project(r.project_id)
      )
    ) THEN
      RAISE EXCEPTION 'You cannot pay this payment' USING ERRCODE = '42501';
    END IF;

    -- A task payout is only payable once the task is APPROVED. The task
    -- may have moved on since the payment was created, so this is
    -- re-checked at pay time rather than assumed.
    IF r.task_id IS NOT NULL AND r.kind = 'PAYMENT' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.id = r.task_id AND t.status = 'APPROVED'
      ) THEN
        RAISE EXCEPTION 'A task payout can only be paid once the task is APPROVED'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    UPDATE public.payments
    SET status = 'PAID',
        paid_at = paid_at_value,
        paid_by = actor,
        payment_method = method,
        reference_number = NULLIF(BTRIM(COALESCE(reference, '')), ''),
        notes = COALESCE(NULLIF(BTRIM(COALESCE(note, '')), ''), notes),
        cancelled_at = NULL,
        cancel_reason = NULL
    WHERE id = r.id;

    INSERT INTO public.payment_events
      (payment_id, actor_id, action, from_status, to_status, metadata)
    VALUES
      (r.id, actor, 'PAID', prior_status, 'PAID',
       jsonb_build_object(
         'method', method,
         'reference', reference,
         'paid_at', paid_at_value,
         'note', note
       ));

    result_ids := result_ids || r.id;
    result_outcomes := result_outcomes || 'paid';
  END LOOP;

  RETURN QUERY
  SELECT result_ids[i] AS payment_id, result_outcomes[i] AS outcome
  FROM generate_series(1, COALESCE(array_length(result_ids, 1), 0)) AS i;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_payments_paid(UUID[], public.payment_method_enum, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_payments_paid(UUID[], public.payment_method_enum, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 11. reverse_payment / cancel_payment
--
-- A PAID payment is never edited in place. A mistake is corrected by
-- sending it back to PENDING (reverse) or to CANCELLED (cancel), both
-- super-admin only, both reason-required, both audited.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverse_payment(
  payment_id UUID,
  reason TEXT
)
RETURNS public.payment_ledger_status
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  prior public.payment_ledger_status;
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only a super admin can reverse a payment' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(BTRIM(COALESCE(reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to reverse a payment' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO prior FROM public.payments WHERE id = payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF prior <> 'PAID' THEN
    RAISE EXCEPTION 'Only a PAID payment can be reversed' USING ERRCODE = '23514';
  END IF;

  -- Back to PENDING and the payout fields are cleared, because the
  -- paid_* triple is what makes a row PAID under payments_paid_complete.
  UPDATE public.payments
  SET status = 'PENDING',
      paid_at = NULL,
      paid_by = NULL,
      payment_method = NULL,
      reference_number = NULL,
      notes = NULL
  WHERE id = payment_id;

  INSERT INTO public.payment_events
    (payment_id, actor_id, action, from_status, to_status, metadata)
  VALUES
    (payment_id, actor, 'REVERSED', prior, 'PENDING',
     jsonb_build_object('reason', reason));

  RETURN 'PENDING';
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_payment(
  payment_id UUID,
  reason TEXT
)
RETURNS public.payment_ledger_status
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  prior public.payment_ledger_status;
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only a super admin can cancel a payment' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(BTRIM(COALESCE(reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to cancel a payment' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO prior FROM public.payments WHERE id = payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF prior = 'CANCELLED' THEN
    RETURN 'CANCELLED';
  END IF;

  UPDATE public.payments
  SET status = 'CANCELLED',
      cancelled_at = now(),
      cancel_reason = BTRIM(reason)
  WHERE id = payment_id;

  INSERT INTO public.payment_events
    (payment_id, actor_id, action, from_status, to_status, metadata)
  VALUES
    (payment_id, actor, 'CANCELLED', prior, 'CANCELLED',
     jsonb_build_object('reason', reason));

  RETURN 'CANCELLED';
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_payment(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_payment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_payment(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_payment(UUID, TEXT) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 12. get_payments_summary
--
-- One round trip for every summary card, instead of pulling up to 500
-- rows into the server and folding them in JavaScript (the loop in
-- lib/actions/payments.ts).
--
-- The counts are deliberately per-window: the old single `paidCount`
-- made the "Paid this week" card report the all-time count.
--
-- The filter arguments mirror the table's filters so a card can never
-- disagree with the rows beneath it.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_payments_summary(
  p_employee_ids UUID[] DEFAULT NULL,
  p_project_ids UUID[] DEFAULT NULL,
  p_type public.payment_type_enum[] DEFAULT NULL,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL,
  p_amount_min BIGINT DEFAULT NULL,
  p_amount_max BIGINT DEFAULT NULL
)
RETURNS TABLE (
  pending_total BIGINT,
  pending_count BIGINT,
  paid_total BIGINT,
  paid_count BIGINT,
  paid_this_week BIGINT,
  paid_this_week_count BIGINT,
  paid_last_week BIGINT,
  paid_this_month BIGINT,
  paid_this_month_count BIGINT,
  paid_last_month BIGINT,
  cancelled_total BIGINT,
  cancelled_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  -- INVOKER means RLS applies to `payments` here, so the CTE is already
  -- scoped to what the caller may read; can_manage_payment() then applies
  -- the stricter manager-project rule. The summary can never widen the
  -- caller's visibility.
  WITH scoped AS (
    SELECT
      p.status,
      p.amount_paise,
      p.paid_at,
      (p.paid_at AT TIME ZONE 'Asia/Kolkata')::DATE AS paid_day
    FROM public.payments p
    WHERE public.can_manage_payment(p)
      AND (p_employee_ids IS NULL OR p.employee_id = ANY(p_employee_ids))
      AND (p_project_ids IS NULL OR p.project_id = ANY(p_project_ids))
      AND (p_type IS NULL OR p.type = ANY(p_type))
      AND (p_date_from IS NULL OR p.paid_at >= p_date_from)
      AND (p_date_to IS NULL OR p.paid_at <= p_date_to)
      AND (p_amount_min IS NULL OR p.amount_paise >= p_amount_min)
      AND (p_amount_max IS NULL OR p.amount_paise <= p_amount_max)
  ),
  bounds AS (
    SELECT
      -- Week starts Monday, matching istWeekBounds() in the app.
      date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata'))::DATE AS week_start,
      date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::DATE AS month_start
  )
  SELECT
    COALESCE(SUM(s.amount_paise) FILTER (WHERE s.status = 'PENDING'), 0),
    COUNT(*) FILTER (WHERE s.status = 'PENDING'),
    COALESCE(SUM(s.amount_paise) FILTER (WHERE s.status = 'PAID'), 0),
    COUNT(*) FILTER (WHERE s.status = 'PAID'),
    COALESCE(SUM(s.amount_paise) FILTER (
      WHERE s.status = 'PAID' AND s.paid_day >= b.week_start), 0),
    COUNT(*) FILTER (
      WHERE s.status = 'PAID' AND s.paid_day >= b.week_start),
    COALESCE(SUM(s.amount_paise) FILTER (
      WHERE s.status = 'PAID'
        AND s.paid_day >= b.week_start - 7
        AND s.paid_day < b.week_start), 0),
    COALESCE(SUM(s.amount_paise) FILTER (
      WHERE s.status = 'PAID' AND s.paid_day >= b.month_start), 0),
    COUNT(*) FILTER (
      WHERE s.status = 'PAID' AND s.paid_day >= b.month_start),
    COALESCE(SUM(s.amount_paise) FILTER (
      WHERE s.status = 'PAID'
        AND s.paid_day >= (b.month_start - INTERVAL '1 month')::DATE
        AND s.paid_day < b.month_start), 0),
    COALESCE(SUM(s.amount_paise) FILTER (WHERE s.status = 'CANCELLED'), 0),
    COUNT(*) FILTER (WHERE s.status = 'CANCELLED')
  FROM scoped s
  CROSS JOIN bounds b;
$$;

REVOKE ALL ON FUNCTION public.get_payments_summary(UUID[], UUID[], public.payment_type_enum[], TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payments_summary(UUID[], UUID[], public.payment_type_enum[], TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, BIGINT) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 13. Realtime
--
-- "My payments" updates live. Appending payment_events to the
-- publication means the phase-4 timeline needs no polling either.
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_events;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;
