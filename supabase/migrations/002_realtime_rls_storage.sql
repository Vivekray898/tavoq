-- ============================================================
-- Taskora — Migration 002
-- Realtime publication, storage bucket, RLS hardening,
-- notification preferences.
--
-- Run AFTER 001_initial_schema.sql.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. Realtime publication (§45)
-- Without this, every postgres_changes subscription in the
-- app silently receives nothing.
-- ──────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE task_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE project_resources;
ALTER PUBLICATION supabase_realtime ADD TABLE activity;
ALTER PUBLICATION supabase_realtime ADD TABLE task_subtasks;

-- RLS-protected tables broadcast only to users who can read the
-- row (Supabase enforces the table's SELECT policies for the
-- subscribing user automatically).

-- ──────────────────────────────────────────────
-- 2. RLS hardening — payment immutability (§48)
-- An employee must never be able to change payout_amount,
-- payment_status, assigned_to or project_id, and must only be
-- able to move their own task through the allowed transitions.
-- The server action enforces the same rules; this trigger is the
-- database-level backstop.
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_task_update_rules()
RETURNS TRIGGER AS $$
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

  -- Employees may only touch their own tasks
  IF OLD.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed to modify a task that is not assigned to you';
  END IF;

  -- Protected columns: employee cannot change payout, payment,
  -- assignment, or move the task to another project
  IF NEW.payout_amount IS DISTINCT FROM OLD.payout_amount
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Not allowed to modify protected task fields';
  END IF;

  -- Only status (and completed_at via status=COMPLETED) may change
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'TODO'             AND NEW.status = 'IN_PROGRESS') OR
      (OLD.status = 'IN_PROGRESS'      AND NEW.status = 'SUBMITTED') OR
      (OLD.status = 'REVISION_REQUIRED' AND NEW.status = 'IN_PROGRESS') OR
      (OLD.status = 'REVISION_REQUIRED' AND NEW.status = 'SUBMITTED')
    ) THEN
      RAISE EXCEPTION 'Allowed status transition violated: % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'SUBMITTED' THEN
      NEW.completed_at = NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_enforce_task_update_rules
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION enforce_task_update_rules();

-- ──────────────────────────────────────────────
-- 3. Storage: private attachments bucket (§49)
-- ──────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Read: assignee, project members, or admins
CREATE POLICY "Read own task attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.task_attachments ta
      JOIN public.tasks t ON t.id = ta.task_id
      WHERE ta.file_path = name
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'ADMIN'
          )
        )
    )
  );

-- Upload: same access rules, must reference a real attachment row
CREATE POLICY "Upload own task attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.task_attachments ta
      WHERE ta.file_path = name
        AND (
          ta.uploaded_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'ADMIN'
          )
        )
    )
  );

-- Delete: uploader or admin
CREATE POLICY "Delete own or admin attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.task_attachments ta
      WHERE ta.file_path = name
        AND (ta.uploaded_by = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND p.role = 'ADMIN'
             ))
    )
  );

-- ──────────────────────────────────────────────
-- 4. Notification preferences (§62)
-- ──────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ──────────────────────────────────────────────
-- 5. Realtime helper indexes
-- Realtime + filters hit these columns constantly.
-- ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
