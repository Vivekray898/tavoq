-- ══════════════════════════════════════════════════════════════
-- 011 — Free task status transitions
--
-- The board should allow any card to move to any column. The
-- enforce_task_update_rules() trigger from migration 002 enforced a
-- narrow allow-list (TODO → IN_PROGRESS → SUBMITTED, etc.) and raised
-- 'Allowed status transition violated' for everything else.
--
-- This keeps the trigger's real job — stopping an employee from
-- touching immutable/payout fields on a task they don't own — and
-- drops only the status-transition guardrails.
--
-- Authorization is unchanged: non-admins can still only modify tasks
-- assigned to them, and payout_amount / payment_status / assigned_to /
-- project_id remain protected. RLS policies are not touched.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_task_update_rules()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  ) INTO is_admin;

  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- Employees may only modify their own tasks
  IF OLD.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed to modify a task that is not assigned to you';
  END IF;

  -- Protected columns stay protected
  IF NEW.payout_amount IS DISTINCT FROM OLD.payout_amount
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Not allowed to modify protected task fields';
  END IF;

  -- Status: any transition between the five values is allowed, in any
  -- direction, for admins and assignees alike. completed_at is kept
  -- coherent with the new status so the board and the payments
  -- workspace never disagree about whether a task is done.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'COMPLETED' AND NEW.completed_at IS NULL THEN
      NEW.completed_at = now();
    ELSIF NEW.status <> 'COMPLETED' THEN
      NEW.completed_at = NULL;
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trigger_enforce_task_update_rules ON public.tasks;
CREATE TRIGGER trigger_enforce_task_update_rules
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_update_rules();
