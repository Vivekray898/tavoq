-- ============================================================
-- Taskora — Migration 015
-- Realtime publication coverage.
--
-- The realtime provider subscribes to postgres_changes on several
-- tables. Postgres only delivers a table's events to subscribers when
-- that table is in the `supabase_realtime` publication — a table that
-- isn't listed simply never fires, with no error to indicate why.
--
-- This migration guarantees every table the client subscribes to is
-- published. It is the difference between "the feature is written"
-- and "the feature actually delivers events".
--
-- Idempotent: safe to run repeatedly. `pg_publication_tables` is
-- checked first, so an existing entry is left alone.
--
-- Run AFTER 014_role_hierarchy.sql. Order: 001 → 015.
--
-- ────────────────────────────────────────────────────────────
-- DOWN MIGRATION
--
--   ALTER PUBLICATION supabase_realtime DROP TABLE
--     public.profiles, public.project_members;
--
-- Note that removing a table from the publication silently stops its
-- realtime events; no error surfaces in the application.
-- ============================================================

-- Tables the realtime provider subscribes to. Kept in sync with
-- components/providers/realtime-provider.tsx.
DO $$
DECLARE
  t TEXT;
  wanted TEXT[] := ARRAY[
    'notifications',
    'tasks',
    'task_comments',
    'payments',
    'activity',
    'project_resources',
    'task_subtasks',
    'profiles',
    'project_members',
    'projects',
    'clients'
  ];
BEGIN
  FOREACH t IN ARRAY wanted LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'added % to supabase_realtime', t;
    END IF;
  END LOOP;
END $$;