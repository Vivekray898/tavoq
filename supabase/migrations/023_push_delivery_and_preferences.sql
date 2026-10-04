-- ============================================================
-- Taskora — Migration 023
-- Push delivery hardening: last_success_at, per-user
-- notification preferences, and a delivery log for dedupe.
--
-- WHY THIS EXISTS
--
-- Phase 2 asked to "respect per-user notification preferences"
-- and to "dedupe via log table". Neither existed:
--
--   1. push_subscriptions had no last_success_at, so a device
--      that had silently stopped receiving pushes was
--      indistinguishable from a healthy one. The sender now
--      stamps every successful delivery, and a subscription
--      that has never succeeded can be surfaced and cleaned up.
--
--   2. There was no notification-preference storage AT ALL.
--      "Respect per-user notification preferences" therefore
--      required new schema, not a code change. notification_preferences
--      holds one row per user with a boolean per event channel,
--      defaulting to ON so behaviour is unchanged after deploy —
--      an existing user must not silently stop being notified.
--
--   3. daily_reminder_log already dedupes the 5am cron, but
--      push-driven triggers (assignment, comment, payment) had
--      no equivalent. push_delivery_log records a dedupe key per
--      delivery so a retried or duplicated trigger cannot spam a
--      user's phone twice.
--
--   4. "status changed" was named as a push trigger but had no
--      notification type to hang off. notification_type gains
--      TASK_STATUS_CHANGED.
--
-- ENUM ORDERING (see scripts/verify-migration-enum-order.mjs)
--
-- Postgres raises 55P04 if a migration adds an enum value and
-- then USES that value in the same file. This migration only
-- ADDS 'TASK_STATUS_CHANGED' and never uses it in SQL, so a
-- single file is correct. The value is consumed by application
-- code in a later deploy.
--
-- Idempotent. Run AFTER 021_push_and_calendar_cleanup.sql.
--
-- DOWN MIGRATION
--   DROP TABLE IF EXISTS public.push_delivery_log;
--   DROP TABLE IF EXISTS public.notification_preferences;
--   ALTER TABLE public.push_subscriptions
--     DROP COLUMN IF EXISTS last_success_at;
--   -- 'TASK_STATUS_CHANGED' cannot be removed from an enum in
--   Postgres; leave it in place (it is harmless once unused).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Delivery health on each subscription.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;

COMMENT ON COLUMN public.push_subscriptions.last_success_at IS
  'Last time a push was delivered to this endpoint without a 4xx/5xx. NULL means never delivered successfully.';

-- ────────────────────────────────────────────────────────────
-- 2. Per-user notification preferences.
--
-- One row per user, created on demand. Every channel defaults
-- to true so the deploy does not change anyone's behaviour.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_assigned BOOLEAN NOT NULL DEFAULT TRUE,
  status_changed BOOLEAN NOT NULL DEFAULT TRUE,
  review_requested BOOLEAN NOT NULL DEFAULT TRUE,
  comment_added BOOLEAN NOT NULL DEFAULT TRUE,
  payment_paid BOOLEAN NOT NULL DEFAULT TRUE,
  due_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  -- Master switch. False means no push reaches this user at all,
  -- regardless of the per-channel flags.
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- A user reads and writes exactly their own row. Nobody else,
-- including other authenticated staff, may touch it.
DROP POLICY IF EXISTS "Users manage own notification preferences"
  ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences"
  ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- The sender is server-side and uses the service role, which
-- bypasses RLS. This policy exists so the intent is explicit and
-- so a future audit of RLS policies shows the read path.
DROP POLICY IF EXISTS "Service role reads notification preferences"
  ON public.notification_preferences;
CREATE POLICY "Service role reads notification preferences"
  ON public.notification_preferences FOR SELECT TO service_role
  USING (true);

-- ────────────────────────────────────────────────────────────
-- 3. Push delivery log (dedupe).
--
-- dedupe_key is caller-supplied and unique, so a second insert
-- for the same key is rejected rather than delivering twice.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'PUSH',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_delivery_log_uniq
  ON public.push_delivery_log(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_push_delivery_log_user
  ON public.push_delivery_log(user_id);

ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;

-- The log is server-side bookkeeping. Users never read or write
-- it, so no user policy is granted; service_role bypasses RLS.
DROP POLICY IF EXISTS "Service role manages push delivery log"
  ON public.push_delivery_log;
CREATE POLICY "Service role manages push delivery log"
  ON public.push_delivery_log FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 4. Status-change notification type.
--
-- ADD VALUE only — this migration never uses the value, which
-- is what keeps it valid under Postgres 55P04. See the header.
-- ────────────────────────────────────────────────────────────
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'TASK_STATUS_CHANGED';