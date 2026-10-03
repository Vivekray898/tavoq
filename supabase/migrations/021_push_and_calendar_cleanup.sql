-- ============================================================
-- Taskora — Migration 021
-- Push-notification housekeeping and calendar-move cleanup.
--
-- WHY THIS EXISTS
-- Web Push already works end to end (public/sw.js, /api/push/*,
-- lib/push.ts). What is missing is enough structure on the two
-- tables it leans on:
--
--   1. push_subscriptions has no discriminator. It only holds Web
--      Push subscriptions today, but nothing stops a future channel
--      (e.g. a different push provider) from writing a row that the
--      Web Push sender would then try — and fail — to deliver to.
--      `kind` makes the channel explicit so the sender can filter.
--
--   2. daily_reminder_log de-duplicates on (user_id, task_id,
--      reminder_date) with a hard UNIQUE constraint. The daily cron
--      now sends BOTH a push and (optionally) an email for the same
--      task on the same day. Keeping the unique key at three columns
--      means the two channels would collide on insert, so one of them
--      would silently never be recorded. Widening the key to include
--      `kind` lets one row exist per channel per task per day while
--      still making a same-channel re-run a no-op.
--
-- NOTHING IS DROPPED. Every statement is additive or a constraint
-- swap, and the backfill below assigns 'PUSH' to all existing rows so
-- the widened unique index has no nulls to collide on.
--
-- Idempotent. Run AFTER 019_payment_adjustments.sql.
--
-- ────────────────────────────────────────────────────────────
-- DOWN MIGRATION
--   Reverse in this order:
--
--   -- 1. Back to one row per user/task/day. Collapses any day on
--   --    which a task produced both a push and an email, keeping the
--   --    earliest of each pair:
--   DELETE FROM public.daily_reminder_log a
--    USING public.daily_reminder_log b
--    WHERE a.user_id = b.user_id
--      AND a.task_id = b.task_id
--      AND a.reminder_date = b.reminder_date
--      AND a.id > b.id;
--
--   DROP INDEX IF EXISTS public.daily_reminder_log_uniq;
--   ALTER TABLE public.daily_reminder_log
--     ADD CONSTRAINT daily_reminder_log_user_id_task_id_reminder_date_key
--     UNIQUE (user_id, task_id, reminder_date);
--
--   -- 2. Drop the kind columns (only safe once step 1 has run).
--   ALTER TABLE public.daily_reminder_log DROP COLUMN IF EXISTS kind;
--   ALTER TABLE public.push_subscriptions  DROP COLUMN IF EXISTS kind;
--
-- Note: reverting the unique constraint requires it not to already
-- exist under that name, hence the DROP CONSTRAINT IF EXISTS first
-- in the forward direction.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Push subscription channel discriminator.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'WEB_PUSH';

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_kind_check;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_kind_check
  CHECK (kind IN ('WEB_PUSH'));

-- The sender filters on this, so it needs to be cheap. Partial:
-- every current row is WEB_PUSH, but the index stays small if other
-- channels are ever added.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_kind
  ON public.push_subscriptions(user_id, kind);

-- ────────────────────────────────────────────────────────────
-- 2. Reminder channel, so push and email de-duplicate separately.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.daily_reminder_log
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'PUSH';

-- Backfill explicitly. The column default already covers new rows, but
-- a NOT NULL column added with DEFAULT is backfilled by Postgres; this
-- makes the intent visible and covers any row written by an older
-- client that bypassed the default.
UPDATE public.daily_reminder_log SET kind = 'PUSH' WHERE kind IS NULL;

-- Swap the unique key from (user, task, day) to (user, task, day,
-- channel). The old constraint must go first — Postgres would reject
-- adding a second unique index over a prefix of an existing one only
-- on conflict, so it is dropped and recreated under the wider key.
ALTER TABLE public.daily_reminder_log
  DROP CONSTRAINT IF EXISTS daily_reminder_log_user_id_task_id_reminder_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS daily_reminder_log_uniq
  ON public.daily_reminder_log (user_id, task_id, reminder_date, kind);

-- The cron reads this to skip work, so index the lookup it actually
-- performs (all rows for a given day).
CREATE INDEX IF NOT EXISTS idx_daily_reminder_log_date
  ON public.daily_reminder_log(reminder_date);

-- ────────────────────────────────────────────────────────────
-- 3. Indexes that the new auto-sync path depends on.
--
-- syncAssigneeCalendar looks up an assignee's token and their token
-- row; the token lookup already has a unique index on user_id, but the
-- cron reconciliation pass walks tokens by channel expiry, which has
-- no index today and would table-scan.
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_google_tokens_channel_expires
  ON public.user_google_tokens(channel_expires_at)
  WHERE channel_expires_at IS NOT NULL;

-- No RLS change. push_subscriptions and user_google_tokens keep the
-- policies from migrations 008 and 012 respectively; user_google_tokens
-- remains SELECT-denied to anon/authenticated so an encrypted refresh
-- token can never reach the browser bundle.