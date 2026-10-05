-- Taskora — Migration 028
-- Two Google Calendar sync modes over one mapping table.
--
-- WHY THIS EXISTS
--
-- The outbound sync had exactly one task-selection rule:
--
--     SELECT ... FROM tasks WHERE assigned_to = userId
--
-- That is correct for an employee, whose calendar is the work assigned
-- to them. It is wrong for a SUPER_ADMIN, who creates and assigns work
-- to other people and is therefore almost never the assignee. Their
-- sync loaded zero rows, created zero events, and reported zero errors
-- — indistinguishable from "nothing to do".
--
-- The fix is a second SELECTION STRATEGY, not a second sync engine and
-- not a second mapping table:
--
--   personal          tasks where assigned_to = userId
--   admin_assignment  tasks where created_by  = userId
--
-- WHY created_by, NOT A NEW COLUMN
--
-- `created_by` already exists (migrations 001 and 004), is already
-- written by every task create path, and already answers "this admin
-- put this work in motion". A new `assigned_by` column would have to be
-- populated by every mutation path, kept correct across reassignment,
-- backfilled, and RLS-reviewed — all to store a fact we already have.
-- Reassignment deliberately does NOT clear created_by, which is exactly
-- the required behaviour: the admin keeps the task on their calendar
-- after it moves between employees.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
--
--   • No new mapping table. `calendar_events` is already unique on
--     (user_id, task_id), so one task can hold a DIFFERENT google_event_id
--     per user. A single `tasks.google_event_id` column cannot express
--     that, and it is already read as a legacy fallback only.
--   • No RLS change. calendar_events keeps user-read / service-role-write.
--   • No token or OAuth change.
--
-- DOWN MIGRATION
--   ALTER TABLE public.calendar_events DROP COLUMN IF EXISTS sync_mode;
--   DROP INDEX IF EXISTS idx_tasks_created_by;

-- ────────────────────────────────────────────────────────────
-- 1. Which selection strategy produced a mapping row.
--
-- Recorded rather than derived: the row is the record of what a past
-- sync did, and a task can be present in several users' calendars for
-- different reasons. DEFAULT 'personal' is chosen over NULL because
-- every row written before this migration came from the
-- assigned_to-only rule, which IS the personal strategy.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS sync_mode TEXT NOT NULL DEFAULT 'personal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_events_sync_mode_check'
      AND conrelid = 'public.calendar_events'::regclass
  ) THEN
    ALTER TABLE public.calendar_events
      ADD CONSTRAINT calendar_events_sync_mode_check
      CHECK (sync_mode IN ('personal', 'admin_assignment'));
  END IF;
END
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Index for the admin-assignment selection.
--
-- The personal path already had idx on tasks.assigned_to; the admin
-- path had none, so `WHERE created_by = userId` was a sequential scan
-- over tasks on every admin sync. Without this an admin with a large
-- task table pays for the whole table on each "Sync assigned work".
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_created_by
  ON public.tasks(created_by)
  WHERE created_by IS NOT NULL;