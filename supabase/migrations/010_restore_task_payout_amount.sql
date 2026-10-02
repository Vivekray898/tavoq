-- ══════════════════════════════════════════════════════════════
-- 010 — Restore task-level suggested payouts
--
-- `payout_amount` was dropped from `public.tasks`, but the payments
-- workspace still treats it as the *suggested default* payout the
-- admin sees and can override. `payments.amount` remains the single
-- authoritative value for what was actually paid.
--
-- This migration is idempotent and safe to re-run.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS payout_amount NUMERIC(10,2);

-- Seed the restored column from the payments that already exist, so
-- completed/paid tasks keep the payout the admin actually recorded.
UPDATE public.tasks t
SET payout_amount = p.amount
FROM public.payments p
WHERE p.task_id = t.id AND t.payout_amount IS NULL;

-- Everything else defaults to a zero suggestion (explicitly 0 rather
-- than NULL so the UI renders "0" instead of an empty field).
UPDATE public.tasks SET payout_amount = 0 WHERE payout_amount IS NULL;

-- ──────────────────────────────────────────────
-- Trigger: a task that becomes COMPLETED with a
-- positive suggested payout gets a PENDING payment
-- row, so it shows up on the payments dashboard and
-- stays payable until an admin settles it.
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_payment_on_task_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'COMPLETED'
     AND (OLD.status IS DISTINCT FROM 'COMPLETED')
     AND COALESCE(NEW.payout_amount, 0) > 0
     AND NEW.assigned_to IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.payments WHERE task_id = NEW.id)
  THEN
    INSERT INTO public.payments (task_id, employee_id, amount, paid_at, paid_by, payment_note)
    VALUES (NEW.id, NEW.assigned_to, NEW.payout_amount, NULL, NULL, NULL);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trigger_create_payment_on_task_completion ON public.tasks;
CREATE TRIGGER trigger_create_payment_on_task_completion
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.create_payment_on_task_completion();

-- Backfill already-completed tasks that never got a payment row
-- (the window where the column was missing).
INSERT INTO public.payments (task_id, employee_id, amount, paid_at, paid_by, payment_note)
SELECT t.id, t.assigned_to, t.payout_amount, NULL, NULL, 'Backfilled from completed task'
FROM public.tasks t
WHERE t.status = 'COMPLETED'
  AND COALESCE(t.payout_amount, 0) > 0
  AND t.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.task_id = t.id);