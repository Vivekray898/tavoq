-- ============================================================
-- Taskora — Migration 016
-- Google Calendar ownership: one event per task, owned by its
-- assignee.
--
-- ── The problem this fixes ────────────────────────────────────
--
-- `tasks.google_event_id` is a single column shared by every user,
-- but the calendar it points at belongs to ONE account (the person
-- whose refresh token is in user_google_tokens). So the column can
-- only ever describe one owner's event.
--
-- When a task is reassigned from A to B, the old event id stays set.
-- B's next sync sees a non-null google_event_id, assumes the event
-- already exists in B's calendar, and issues a PUT against an event id
-- that belongs to A's calendar — which either fails with 404 or, worse,
-- updates nothing while B's calendar silently lacks the task.
--
-- ── The chosen approach ───────────────────────────────────────
--
-- Clear `google_event_id` on reassignment rather than tracking an
-- explicit owner column. The alternative — adding
-- `tasks.google_event_owner UUID` — buys the ability to delete the
-- departing owner's event directly, at the cost of a second source of
-- truth that can disagree with the token table. Clearing is
-- self-correcting: the next sync simply creates the event for whoever
-- owns the task now.
--
-- The trade-off is that the previous owner's event lingers in their
-- calendar until they notice. That is a cosmetic leftover in one
-- person's calendar, versus a duplicated or orphaned event in every
-- connected admin's calendar.
--
-- ── Why duplicates happened in the first place ─────────────────
--
-- Not fan-out: syncTaskToCalendar() and fullSyncForUser() both
-- already filter on `assigned_to = <the caller>`, so a super admin
-- only ever syncs their own assigned tasks. The observable duplicate
-- came from the reassignment bug above plus the one-time cleanup below.
--
-- Idempotent: safe to run repeatedly.
--
-- Run AFTER 015_realtime_publication.sql. Order: 001 → 016.
--
-- ────────────────────────────────────────────────────────────
-- DOWN MIGRATION
--
--   DROP TRIGGER IF EXISTS trigger_clear_google_event_on_reassign
--     ON public.tasks;
--   DROP FUNCTION IF EXISTS public.clear_google_event_on_reassign();
--
-- The one-time cleanup in step 1 is NOT reversible: it discards
-- event ids that cannot be restored. Re-applying the previous behaviour
-- would require re-running a full sync, which recreates events from
-- scratch.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. One-time cleanup.
--
-- Clear any event id that does not belong to the current assignee's
-- own connection. Rows whose assignee has connected a calendar are
-- left alone (their event id is legitimately theirs); everything else
-- is stale and must be rebuilt by the next sync.
--
-- Keep an event id only when the task's current assignee is someone
-- who actually holds a connected calendar — i.e. the id could
-- plausibly be theirs. Every other id is stale: it either belongs to a
-- previous assignee, or to a user who has since disconnected.
--
-- Tasks assigned to users with no token are cleared too. Their
-- google_event_id cannot be pushed or verified, and leaving it set
-- would make a later connection believe the event already exists.
-- ──────────────────────────────────────────────

UPDATE public.tasks t
SET google_event_id = NULL
WHERE t.google_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_google_tokens tok
    WHERE tok.user_id = t.assigned_to
  );

-- ──────────────────────────────────────────────
-- 2. Clear the event id whenever a task changes hands.
--
-- BEFORE UPDATE, so the stored id is already null when any AFTER
-- trigger or application read sees the new assignment. This also
-- covers the bulk-assignment action, which updates many rows at once.
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.clear_google_event_on_reassign()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    -- The new assignee owns the task now; any existing event belongs to
    -- someone else and must not be carried over. Their next sync
    -- creates a fresh event in their own calendar.
    NEW.google_event_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_clear_google_event_on_reassign ON public.tasks;
CREATE TRIGGER trigger_clear_google_event_on_reassign
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_google_event_on_reassign();

-- ──────────────────────────────────────────────
-- 3. Keep Realtime honest.
--
-- A BEFORE UPDATE trigger rewriting a column means clients that rely
-- on old_record for an UPDATE will see the cleared value. Nothing to
-- do here beyond documenting it: the realtime provider patches task
-- rows from payload.new, which is correct.
-- ──────────────────────────────────────────────