-- ============================================================
-- Taskora — Migration 009
-- Dedicated employee payout management.
--
-- 1. payments table gains an employee-scoped, task-optional shape:
--      employee_id  UUID  -> profiles (owner of the payout)
--      description  TEXT  -> custom-payment text (bonus, retainer…)
--      task_id becomes NULLABLE and non-unique (a custom payment
--      has no task; task-based payments stay 1:1 with tasks).
-- 2. RLS is rewritten so employees can read their own payments
--    (via employee_id, incl. legacy rows backfilled from tasks).
-- 3. Backfills employee_id for every legacy task-based payment.
--
-- Non-destructive: no existing rows are deleted or reset.
-- Run AFTER 008_security_consolidation.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Schema adjustment
-- ------------------------------------------------------------

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Custom payments don't reference a task; the 1:1 constraint for
-- task-based payments moves into the application actions.
ALTER TABLE public.payments
  ALTER COLUMN task_id DROP NOT NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_task_id_key;

-- A payment must always be attributable: either it names its employee
-- directly or it is tied to a task (legacy rows).
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_employee_required;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_employee_required
  CHECK (employee_id IS NOT NULL OR task_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_payments_employee_id
  ON public.payments(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_task_id
  ON public.payments(task_id);

-- ------------------------------------------------------------
-- 2. Backfill employee_id from legacy task-based rows
--    (keeps every existing payment intact & visible)
-- ------------------------------------------------------------

UPDATE public.payments p
SET employee_id = t.assigned_to
FROM public.tasks t
WHERE p.task_id = t.id
  AND p.employee_id IS NULL
  AND t.assigned_to IS NOT NULL;

-- Rows whose task has no assignee keep employee_id NULL; they remain
-- readable by admins (see RLS below) and untouched otherwise.

-- ------------------------------------------------------------
-- 3. RLS — employees read payments where they are the employee,
--    including legacy rows backfilled above. The admin manage-all
--    policy from migration 001 is kept as-is.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Employees can read own task payments" ON public.payments;
CREATE POLICY "Employees can read own payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = payments.task_id
        AND t.assigned_to = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 4. Realtime publication already includes payments (002); no
--    change needed. Employee dashboards patch from these events.
-- ------------------------------------------------------------
