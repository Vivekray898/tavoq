-- ============================================================
-- Taskora — Migration 004
-- Vikunja-style task management upgrades:
--   labels, task_labels, subtasks (checklists), saved_filters,
--   activity stream, task ordering.
-- Run AFTER 003_status_simplify.sql.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. Labels (§19)
-- ──────────────────────────────────────────────

CREATE TYPE label_color AS ENUM (
  'GRAY', 'RED', 'ORANGE', 'AMBER', 'GREEN', 'TEAL', 'BLUE', 'VIOLET', 'PINK'
);

CREATE TABLE labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color label_color NOT NULL DEFAULT 'GRAY',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name)
);

CREATE INDEX idx_labels_name ON labels(name);

-- ──────────────────────────────────────────────
-- 2. Task ↔ label join
-- ──────────────────────────────────────────────

CREATE TABLE task_labels (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE INDEX idx_task_labels_label_id ON task_labels(label_id);

-- ──────────────────────────────────────────────
-- 3. Subtasks / checklist (§21)
-- ──────────────────────────────────────────────

CREATE TABLE task_subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_subtasks_task_id ON task_subtasks(task_id, position);

-- Employees may toggle their own subtasks; RLS mirrors tasks access
ALTER TABLE task_subtasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access subtasks via task access"
  ON task_subtasks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_subtasks.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'ADMIN'
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_subtasks.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'ADMIN'
          )
        )
    )
  );

-- ──────────────────────────────────────────────
-- 4. Saved filters (§25)
-- ──────────────────────────────────────────────

CREATE TABLE saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_filters_user ON saved_filters(user_id);

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manage own saved filters"
  ON saved_filters FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ──────────────────────────────────────────────
-- 5. Activity stream (§30) — real events, no synthesis
-- ──────────────────────────────────────────────

CREATE TYPE activity_type AS ENUM (
  'TASK_CREATED', 'TASK_ASSIGNED', 'STATUS_CHANGED', 'DEADLINE_CHANGED',
  'PRIORITY_CHANGED', 'COMMENT_ADDED', 'ATTACHMENT_ADDED', 'ATTACHMENT_DELETED',
  'SUBTASK_ADDED', 'SUBTASK_COMPLETED', 'LABEL_ADDED', 'LABEL_REMOVED',
  'RESOURCE_ADDED', 'RESOURCE_REMOVED', 'PAYMENT_PAID', 'TASK_COMPLETED'
);

CREATE TABLE activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type activity_type NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_task ON activity(task_id, created_at DESC);
CREATE INDEX idx_activity_project ON activity(project_id, created_at DESC);
CREATE INDEX idx_activity_client ON activity(client_id, created_at DESC);
CREATE INDEX idx_activity_created ON activity(created_at DESC);

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Read activity for tasks you can access
CREATE POLICY "Read accessible activity"
  ON activity FOR SELECT
  TO authenticated
  USING (
    (task_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = activity.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    ))
    OR (project_id IS NOT NULL AND task_id IS NULL AND EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = activity.project_id AND pm.user_id = auth.uid()
    ))
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'ADMIN'
    )
  );

-- Written only by triggers / service role
CREATE POLICY "Service role writes activity"
  ON activity FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ──────────────────────────────────────────────
-- 6. Activity triggers — real events only (§30, §66)
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_task_activity()
RETURNS TRIGGER AS $$
DECLARE
  cid UUID;
  pid UUID;
  detail_txt TEXT;
BEGIN
  SELECT p.client_id INTO pid FROM projects p WHERE p.id = NEW.project_id;
  cid := pid; -- client resolved below

  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    VALUES (
      NEW.id,
      NEW.project_id,
      COALESCE(NEW.created_by, NEW.assigned_to),
      'TASK_CREATED',
      NEW.title
    );

    IF NEW.assigned_to IS NOT NULL THEN
      INSERT INTO activity (task_id, project_id, actor_id, type, detail)
      VALUES (NEW.id, NEW.project_id, NEW.created_by, 'TASK_ASSIGNED', NEW.title);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'STATUS_CHANGED', NEW.status::text);
    IF NEW.status = 'COMPLETED' THEN
      INSERT INTO activity (task_id, project_id, actor_id, type, detail)
      VALUES (NEW.id, NEW.project_id, auth.uid(), 'TASK_COMPLETED', NEW.title);
    END IF;
  END IF;

  IF NEW.deadline IS DISTINCT FROM OLD.deadline THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'DEADLINE_CHANGED', NULL);
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'PRIORITY_CHANGED', NEW.priority::text);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_task_activity
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION log_task_activity();

CREATE OR REPLACE FUNCTION log_comment_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity (task_id, project_id, actor_id, type, detail)
  SELECT c.task_id, t.project_id, c.user_id, 'COMMENT_ADDED', LEFT(c.comment, 120)
  FROM tasks t WHERE t.id = c.task_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_comment_activity
  AFTER INSERT ON task_comments
  FOR EACH ROW EXECUTE FUNCTION log_comment_activity();

CREATE OR REPLACE FUNCTION log_attachment_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    SELECT a.task_id, t.project_id, a.uploaded_by, 'ATTACHMENT_ADDED', a.file_name
    FROM tasks t WHERE t.id = a.task_id;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    SELECT a.task_id, t.project_id, a.uploaded_by, 'ATTACHMENT_DELETED', a.file_name
    FROM tasks t WHERE t.id = a.task_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_attachment_activity
  AFTER INSERT OR DELETE ON task_attachments
  FOR EACH ROW EXECUTE FUNCTION log_attachment_activity();

CREATE OR REPLACE FUNCTION log_resource_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity (project_id, actor_id, type, detail)
    VALUES (NEW.project_id, NEW.created_by, 'RESOURCE_ADDED', NEW.title);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO activity (project_id, actor_id, type, detail)
    VALUES (OLD.project_id, OLD.created_by, 'RESOURCE_REMOVED', OLD.title);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_resource_activity
  AFTER INSERT OR DELETE ON project_resources
  FOR EACH ROW EXECUTE FUNCTION log_resource_activity();

CREATE OR REPLACE FUNCTION log_payment_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity (task_id, project_id, actor_id, type, detail)
  SELECT p.task_id, t.project_id, p.paid_by, 'PAYMENT_PAID', p.amount::text
  FROM tasks t WHERE t.id = p.task_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_payment_activity
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION log_payment_activity();

-- ──────────────────────────────────────────────
-- 7. Task ordering for Kanban / manual sort
-- ──────────────────────────────────────────────

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_tasks_sort ON tasks(project_id, sort_order);

-- ──────────────────────────────────────────────
-- 8. Default label set (§19 examples)
-- ──────────────────────────────────────────────

INSERT INTO labels (name, color) VALUES
  ('Design', 'VIOLET'),
  ('Content', 'BLUE'),
  ('Ads', 'AMBER'),
  ('SEO', 'TEAL'),
  ('Website', 'GREEN'),
  ('Urgent', 'RED'),
  ('Client Review', 'PINK')
ON CONFLICT (name) DO NOTHING;
