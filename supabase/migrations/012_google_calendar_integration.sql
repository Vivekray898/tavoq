-- ══════════════════════════════════════════════════════════════
-- 012 — Google Calendar integration
--
-- Per-user OAuth tokens so each employee can push their assigned
-- tasks to their own Google Calendar, plus the task column that
-- records which calendar event a task maps to.
--
-- Runs after 011 (free status transitions) and 010 (restore
-- payout_amount); it doesn't depend on either, but keeping the
-- ordering monotonic avoids surprises.
-- ══════════════════════════════════════════════════════════════

-- Store per-user Google OAuth tokens
CREATE TABLE IF NOT EXISTS public.user_google_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  -- Encrypt at rest. The column holds an AES-256-GCM ciphertext
  -- ("v1:<iv>:<tag>:<ciphertext>", base64url) produced by
  -- lib/crypto/google-token.ts — never the raw refresh token.
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  -- Absolute expiry (epoch ms) of the cached access token.
  access_token_expires_at TIMESTAMPTZ,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  -- Opaque cursor from the last successful incremental sync. NULL
  -- means "no cursor yet" -> the next sync must be a full sync.
  sync_token TEXT,
  channel_id TEXT,
  channel_resource_id TEXT,
  channel_expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Track which tasks have been synced to Google Calendar
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- Index for the "which of my tasks still need syncing" sweep.
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status
  ON public.tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_google_event
  ON public.tasks(google_event_id)
  WHERE google_event_id IS NOT NULL;

-- RLS: users manage their own tokens
ALTER TABLE public.user_google_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own google tokens"
  ON public.user_google_tokens;
CREATE POLICY "Users manage own google tokens"
  ON public.user_google_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Refresh tokens are the crown jewels here: the policy above would
-- otherwise let a user read their own ciphertext through PostgREST,
-- which is fine, but the column must never be exposed to the client
-- bundle. Revoke column access from anon/authenticated and grant it
-- only to service_role, which the server actions use.
REVOKE SELECT ON public.user_google_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_google_tokens TO service_role;

-- Daily reminder de-duplication: one row per employee per task per day
-- so a re-run of the cron (or a manual retry) can't double-notify.
CREATE TABLE IF NOT EXISTS public.daily_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  reminder_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, task_id, reminder_date)
);

ALTER TABLE public.daily_reminder_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own daily reminders"
  ON public.daily_reminder_log;
CREATE POLICY "Users read own daily reminders"
  ON public.daily_reminder_log FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- employees (the task_status enum) is unchanged; the cron filter uses
-- ACTIVE_TASK_STATUSES semantics. Confirm the enum still has the
-- expected values so the daily query is valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'task_status' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'task_status enum missing — run 001_initial_schema.sql first';
  END IF;
END $$;
