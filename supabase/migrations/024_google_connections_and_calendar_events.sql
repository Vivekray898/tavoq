-- NOTIFICATION TYPE: GOOGLE_RECONNECT_REQUIRED is added here because the
-- needs_reconnect flow (markNeedsReconnect in lib/actions/google-calendar.ts)
-- notifies the user, and a 7-day refresh token in Testing mode makes that
-- routine. Added but never used in SQL, which keeps it valid under 55P04.

-- ============================================================
-- Taskora — Migration 024
-- Explicit Google connection state, and a first-class
-- task <-> calendar event mapping.
--
-- WHY THIS EXISTS
--
-- Phase 3 asked for a `google_connections` table and a
-- `calendar_events` mapping table. Neither existed.
--
--   1. Tokens lived in `user_google_tokens`, which has no status
--      column. The only way the app could tell "connected" from
--      "not connected" was whether a row existed — and a revoked
--      grant DELETED that row. Deleting the evidence means the UI
--      can never say "your access expired, please reconnect"; it can
--      only say "not connected", which sends the user through
--      consent again for a problem they did not cause. This table
--      keeps the row and records WHY it stopped working in
--      `status = 'needs_reconnect'`.
--
--   2. The task <-> event mapping lived in `tasks.google_event_id`.
--      A column cannot hold sync state: which connection owns the
--      event, when it was last written, whether the user deleted it
--      by hand, or how many attempts it has had. `calendar_events`
--      can.
--
-- NOTHING IS DROPPED. `user_google_tokens` is left in place and
-- backfilled FROM: dropping a table holding live credentials in the
-- same migration that stops reading it is how working integrations
-- get lost.
--
-- Idempotent. Run AFTER 023_push_delivery_and_preferences.sql.
--
-- DOWN MIGRATION
--   DROP TABLE IF EXISTS public.calendar_events;
--   DROP TABLE IF EXISTS public.google_connections;
--   -- user_google_tokens is intentionally left untouched; it was
--   -- only ever read from, never dropped.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Connection state, including why it stopped working.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_connections (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- AES-256-GCM ciphertext from lib/crypto/google-token.ts
  -- ("v1:<iv>:<tag>:<ciphertext>"), never the raw refresh token.
  encrypted_refresh_token TEXT NOT NULL,
  google_email TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  -- Opaque cursor from the last successful incremental sync.
  -- NULL means "never synced" -> the next sync must be a full sync.
  sync_token TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  -- ACTIVE          : usable, refresh tokens work
  -- NEEDS_RECONNECT : the grant was revoked or expired; the user must
  --                   consent again. This state is the entire point of
  --                   the table — see the header.
  -- ERROR           : something else failed; last_error says what.
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT google_connections_status_check
    CHECK (status IN ('ACTIVE', 'NEEDS_RECONNECT', 'ERROR'))
);

-- The refresh path flips ACTIVE -> NEEDS_RECONNECT on invalid_grant.
-- Without this the lookup scans.
CREATE INDEX IF NOT EXISTS idx_google_connections_status
  ON public.google_connections(status);

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

-- A user may READ their own row so settings can render status, but
-- must never WRITE one: a forged write could point the app at a
-- calendar they do not own, or clear a NEEDS_RECONNECT flag to hide a
-- revoked grant.
DROP POLICY IF EXISTS "Users read own google connection"
  ON public.google_connections;
CREATE POLICY "Users read own google connection"
  ON public.google_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages google connections"
  ON public.google_connections;
CREATE POLICY "Service role manages google connections"
  ON public.google_connections FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 2. task <-> google event mapping.
--
-- One row per (user, task). The unique constraints are what make
-- one-way sync IDEMPOTENT: re-running updates the existing row instead
-- of creating a second event, and the same Google event can never be
-- claimed by two tasks.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  -- Google returns 404 for an event the user deleted by hand. Kept so
  -- the UI can explain why a task stopped appearing on the calendar,
  -- instead of it silently reappearing.
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, task_id),
  UNIQUE (user_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_task ON public.calendar_events(task_id);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- Users read their own mappings (to show "on your calendar"), but
-- never write: the mapping is maintained server-side only.
DROP POLICY IF EXISTS "Users read own calendar events"
  ON public.calendar_events;
CREATE POLICY "Users read own calendar events"
  ON public.calendar_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages calendar events"
  ON public.calendar_events;
CREATE POLICY "Service role manages calendar events"
  ON public.calendar_events FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 3. Backfill.
--
-- Carry live connections over so nobody has to reconnect after
-- deploy. refresh_token is already ciphertext there, so it is copied
-- verbatim — never decrypted and re-encrypted, because the column
-- name changes but the format does not.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.google_connections (
  user_id,
  encrypted_refresh_token,
  google_email,
  calendar_id,
  sync_token,
  connected_at,
  last_synced_at,
  status
)
SELECT
  t.user_id,
  t.refresh_token,
  t.google_email,
  t.calendar_id,
  t.sync_token,
  t.created_at,
  t.last_synced_at,
  'ACTIVE'
FROM public.user_google_tokens t
ON CONFLICT (user_id) DO NOTHING;

-- Carry the existing tasks.google_event_id mapping over.
INSERT INTO public.calendar_events (
  user_id,
  task_id,
  google_event_id,
  last_synced_at
)
SELECT
  k.assigned_to,
  k.id,
  k.google_event_id,
  now()
FROM public.tasks k
WHERE k.google_event_id IS NOT NULL
  AND k.assigned_to IS NOT NULL
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. Notification type for an expired Google grant.
--
-- ADD VALUE only. This migration never uses the value in SQL, which is
-- what keeps it valid under Postgres error 55P04 (see the header).
-- ────────────────────────────────────────────────────────────
ALTER TYPE public.notification_type
  ADD VALUE IF NOT EXISTS 'GOOGLE_RECONNECT_REQUIRED';
