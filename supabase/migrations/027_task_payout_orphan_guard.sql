-- 027_task_payout_orphan_guard.sql
--
-- Follow-up to 026. Creates, updates and deletes NO payment rows.
--
-- ---------------------------------------------------------------------
-- THE CONFLICT THIS FIXES
-- ---------------------------------------------------------------------
-- 026 re-points payments.task_id to ON DELETE SET NULL so a payment
-- outlives its task. Verified on the live database, that did not work:
--
--   ERROR: 23514: new row for relation "payments" violates check
--          constraint "payments_task_payout_has_task"
--
-- Migration 025 added:
--
--   CHECK ((type <> 'TASK_PAYOUT') OR (task_id IS NOT NULL))
--
-- A table CHECK sees only the finished row. When the FK action clears
-- task_id, the row looks exactly like a TASK_PAYOUT with no task, so the
-- CHECK refuses it -- and because the FK action is part of the DELETE,
-- the task delete fails outright.
--
-- That is the worst of both worlds. Under CASCADE the payment died with
-- the task; under SET NULL the task could no longer be deleted at all.
-- 026 alone would have turned silent data loss into a blocked feature.
--
-- ---------------------------------------------------------------------
-- WHY A TRIGGER INSTEAD OF A RELAXED CHECK
-- ---------------------------------------------------------------------
-- Simply dropping the constraint would also drop the guarantee that
-- matters: an application bug must not be able to CREATE a TASK_PAYOUT
-- that names no task.
--
-- So the guarantee moves to a BEFORE trigger, which can see the OLD row
-- and therefore tell the two situations apart:
--
--   INSERT / normal UPDATE with task_id NULL  -> rejected
--   FK orphaning (task_id went from a value to NULL) -> allowed
--
-- The only way task_id reaches NULL is by the referential action firing,
-- i.e. the task genuinely no longer exists. Nothing the application can
-- send produces that transition.
--
-- ---------------------------------------------------------------------
-- ALSO RELAXED: payments_employee_required
-- ---------------------------------------------------------------------
-- 025 added CHECK ((employee_id IS NOT NULL) OR (task_id IS NOT NULL)).
-- That has the same flaw: a row attributable only through its task would
-- fail the same way the moment the task is deleted, blocking the delete.
--
-- Relaxed to require an employee only while money is still owed. A PAID
-- or CANCELLED row is history, and history must not be able to block the
-- deletion of an unrelated business record.
--
-- ---------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------
--     DROP TRIGGER IF EXISTS trigger_payments_task_payout_guard ON public.payments;
--     DROP FUNCTION IF EXISTS public.payments_task_payout_task_guard();
--
--     ALTER TABLE public.payments
--       DROP CONSTRAINT payments_task_payout_has_task,
--       ADD  CONSTRAINT payments_task_payout_has_task
--         CHECK ((type <> 'TASK_PAYOUT') OR (task_id IS NOT NULL));
--
--     ALTER TABLE public.payments
--       DROP CONSTRAINT payments_employee_required,
--       ADD  CONSTRAINT payments_employee_required
--         CHECK ((employee_id IS NOT NULL) OR (task_id IS NOT NULL));
--
-- Rolling back restores a state in which deleting a task that has already
-- been paid is impossible.
-- ---------------------------------------------------------------------

-- Replace the blunt CHECK with one that can recognise referential orphaning.
ALTER TABLE public.payments
  DROP CONSTRAINT payments_task_payout_has_task;

CREATE OR REPLACE FUNCTION public.payments_task_payout_task_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type = 'TASK_PAYOUT' AND NEW.task_id IS NULL THEN
    -- Allowed only as the referential action fires, i.e. the task row was
    -- deleted and the FK set task_id to NULL. For any other write the
    -- application is trying to store a task payout with no task.
    IF NOT (TG_OP = 'UPDATE' AND OLD.task_id IS NOT NULL) THEN
      RAISE EXCEPTION
        'A TASK_PAYOUT payment must reference a task (payment id %)', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_payments_task_payout_guard
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.payments_task_payout_task_guard();

-- Money still owed must be attributable to somebody; settled history need
-- not be, and must never block an unrelated delete.
ALTER TABLE public.payments
  DROP CONSTRAINT payments_employee_required;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_employee_required
  CHECK ((employee_id IS NOT NULL) OR (task_id IS NOT NULL) OR (status <> 'PENDING'));
