-- ============================================================
-- Taskora — Migration 008
-- Security consolidation + data-layer repairs.
--
-- Idempotent: safe to run on a database where any subset of
-- migrations 001–007 has been applied. It (re)asserts the whole
-- authorization model:
--
--   1. New users → role NULL, status PENDING (never auto-admin)
--   2. Authorization helper functions (is_active_user/is_active_admin)
--   3. Profile authorization-field protection trigger
--   4. Status-aware RLS on every table
--   5. Last-admin-safe lifecycle RPC (manage_profile_lifecycle)
--   6. FIXED activity triggers (42P01 bug — comments/attachments/
--      payments inserts were failing)
--   7. invitations table + push_subscriptions table
--
-- Run AFTER all other migrations. Order: 001 → 008.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. Profile lifecycle columns (guard for missing migration 005)
-- ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_status') THEN
    CREATE TYPE profile_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
  END IF;
END $$;

ALTER TABLE profiles
  ALTER COLUMN role DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS status profile_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Legacy rows: keep existing role but preserve the active flag as status
UPDATE profiles
SET status = CASE WHEN active THEN 'ACTIVE'::profile_status ELSE 'SUSPENDED'::profile_status END,
    approved_at = COALESCE(approved_at, created_at)
WHERE role IS NOT NULL AND status = 'PENDING' AND active IS DISTINCT FROM (status = 'ACTIVE');

-- Keep `active` in sync with `status` from now on
CREATE OR REPLACE FUNCTION public.sync_profile_active_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.active := (NEW.status = 'ACTIVE');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_profile_active ON profiles;
CREATE TRIGGER trigger_sync_profile_active
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_active_flag();

CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_status_role ON profiles(status, role);
CREATE INDEX IF NOT EXISTS idx_profiles_approved_by ON profiles(approved_by);

-- ──────────────────────────────────────────────
-- 2. Authorization helper functions
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_active_user(user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = user_id
      AND status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_admin(user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = user_id
      AND status = 'ACTIVE'
      AND role = 'ADMIN'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_admin(UUID) TO authenticated, service_role;

-- ──────────────────────────────────────────────
-- 3. New-user trigger: NO automatic role, NO automatic admin.
--    Every new signup is PENDING with role NULL until an active
--    admin approves them (or they accept an invitation).
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, role, status, active)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''),
    NULL,
    'PENDING',
    false
  )
  -- If a profile already exists (e.g. an account was pre-linked), keep it.
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Users must never be able to change their own role/status/approval.
CREATE OR REPLACE FUNCTION public.protect_profile_authorization_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.id
     AND NOT public.is_active_admin(auth.uid())
     AND (
       NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     ) THEN
    RAISE EXCEPTION 'Only an active admin may change profile authorization fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_profile_authorization_fields ON profiles;
CREATE TRIGGER trigger_protect_profile_authorization_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_authorization_fields();

-- ──────────────────────────────────────────────
-- 4. Status-aware RLS (drop role-only policies, re-assert)
-- ──────────────────────────────────────────────

-- Profiles: everyone may read the minimal directory (needed for
-- assignee names in task cards) but authorization fields are
-- protected; pending/suspended users read only themselves.
DROP POLICY IF EXISTS "Admin can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Active admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Read own or team directory" ON profiles;
CREATE POLICY "Read own or team directory"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (public.is_active_user() AND status = 'ACTIVE')
  );

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Active admins can update any profile" ON profiles;
DROP POLICY IF EXISTS "Update own non-authorization fields" ON profiles;
CREATE POLICY "Update own non-authorization fields"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR public.is_active_admin()
  )
  WITH CHECK (
    id = auth.uid()
    OR public.is_active_admin()
  );

DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Active admins can insert profiles" ON profiles;
CREATE POLICY "Active admins can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_admin());

-- Clients
DROP POLICY IF EXISTS "Admin can manage clients" ON clients;
DROP POLICY IF EXISTS "Active admin manages clients" ON clients;
DROP POLICY IF EXISTS "Employees can read active clients" ON clients;
DROP POLICY IF EXISTS "Active users can read active clients" ON clients;
CREATE POLICY "Active admin manages clients"
  ON clients FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
CREATE POLICY "Active users can read active clients"
  ON clients FOR SELECT TO authenticated
  USING (public.is_active_user() AND active = true);

-- Projects
DROP POLICY IF EXISTS "Admin can manage projects" ON projects;
DROP POLICY IF EXISTS "Active admin manages projects" ON projects;
DROP POLICY IF EXISTS "Employees can read own projects" ON projects;
DROP POLICY IF EXISTS "Active employees can read own projects" ON projects;
CREATE POLICY "Active admin manages projects"
  ON projects FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
CREATE POLICY "Active employees can read own projects"
  ON projects FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = projects.id
        AND project_members.user_id = auth.uid()
    )
  );

-- Project members
DROP POLICY IF EXISTS "Admin can manage project members" ON project_members;
DROP POLICY IF EXISTS "Active admin manages project members" ON project_members;
DROP POLICY IF EXISTS "Employees can read project members" ON project_members;
DROP POLICY IF EXISTS "Members can read project members" ON project_members;
CREATE POLICY "Active admin manages project members"
  ON project_members FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Members can read project members"
  ON project_members FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = project_members.project_id
        AND pm.user_id = auth.uid()
    )
  );

-- Project resources
DROP POLICY IF EXISTS "Admin can manage project resources" ON project_resources;
DROP POLICY IF EXISTS "Active admin manages project resources" ON project_resources;
DROP POLICY IF EXISTS "Employees can read project resources" ON project_resources;
DROP POLICY IF EXISTS "Members can read project resources" ON project_resources;
CREATE POLICY "Active admin manages project resources"
  ON project_resources FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
CREATE POLICY "Members can read project resources"
  ON project_resources FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = project_resources.project_id
        AND project_members.user_id = auth.uid()
    )
  );

-- Tasks
DROP POLICY IF EXISTS "Admin can manage tasks" ON tasks;
DROP POLICY IF EXISTS "Active admin manages tasks" ON tasks;
DROP POLICY IF EXISTS "Employees can read assigned tasks" ON tasks;
DROP POLICY IF EXISTS "Active employees can read assigned tasks" ON tasks;
CREATE POLICY "Active admin manages tasks"
  ON tasks FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
CREATE POLICY "Active employees can read assigned tasks"
  ON tasks FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1 FROM project_members
        WHERE project_members.project_id = tasks.project_id
          AND project_members.user_id = auth.uid()
      )
    )
  );
DROP POLICY IF EXISTS "Employees can update own task status" ON tasks;
DROP POLICY IF EXISTS "Active employees can update own task status" ON tasks;
CREATE POLICY "Active employees can update own task status"
  ON tasks FOR UPDATE TO authenticated
  USING (public.is_active_user() AND assigned_to = auth.uid())
  WITH CHECK (public.is_active_user() AND assigned_to = auth.uid());

-- Task comments
DROP POLICY IF EXISTS "Admin can manage task comments" ON task_comments;
DROP POLICY IF EXISTS "Active admin manages task comments" ON task_comments;
DROP POLICY IF EXISTS "Employees can read task comments" ON task_comments;
DROP POLICY IF EXISTS "Employees can create task comments" ON task_comments;
DROP POLICY IF EXISTS "Read comments on accessible tasks" ON task_comments;
DROP POLICY IF EXISTS "Comment on accessible tasks" ON task_comments;
CREATE POLICY "Active admin manages task comments"
  ON task_comments FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
CREATE POLICY "Read comments on accessible tasks"
  ON task_comments FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_comments.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  );
CREATE POLICY "Comment on accessible tasks"
  ON task_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_comments.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  );

-- Task attachments
DROP POLICY IF EXISTS "Admin can manage task attachments" ON task_attachments;
DROP POLICY IF EXISTS "Active admin manages task attachments" ON task_attachments;
DROP POLICY IF EXISTS "Employees can read task attachments" ON task_attachments;
DROP POLICY IF EXISTS "Employees can create task attachments" ON task_attachments;
DROP POLICY IF EXISTS "Employees can delete own attachments" ON task_attachments;
DROP POLICY IF EXISTS "Read attachments on accessible tasks" ON task_attachments;
DROP POLICY IF EXISTS "Upload attachments to accessible tasks" ON task_attachments;
DROP POLICY IF EXISTS "Delete own attachments" ON task_attachments;
CREATE POLICY "Active admin manages task attachments"
  ON task_attachments FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
CREATE POLICY "Read attachments on accessible tasks"
  ON task_attachments FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_attachments.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  );
CREATE POLICY "Upload attachments to accessible tasks"
  ON task_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_attachments.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  );
CREATE POLICY "Delete own attachments"
  ON task_attachments FOR DELETE TO authenticated
  USING (public.is_active_user() AND uploaded_by = auth.uid());

-- Payments
DROP POLICY IF EXISTS "Admin can manage payments" ON payments;
DROP POLICY IF EXISTS "Active admin manages payments" ON payments;
DROP POLICY IF EXISTS "Employees can read own task payments" ON payments;
DROP POLICY IF EXISTS "Active employees can read own task payments" ON payments;
CREATE POLICY "Active admin manages payments"
  ON payments FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
CREATE POLICY "Active employees can read own task payments"
  ON payments FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = payments.task_id
        AND tasks.assigned_to = auth.uid()
    )
  );

-- Notifications: read/update own only; inserts via service role.
DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
DROP POLICY IF EXISTS "Active users can read own notifications" ON notifications;
CREATE POLICY "Active users can read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Active users can update own notifications" ON notifications;
CREATE POLICY "Active users can update own notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid())
  WITH CHECK (public.is_active_user() AND user_id = auth.uid());
DROP POLICY IF EXISTS "Service role can insert notifications" ON notifications;
CREATE POLICY "Service role can insert notifications"
  ON notifications FOR INSERT TO service_role
  WITH CHECK (true);

-- user_devices (legacy table kept for compatibility)
DROP POLICY IF EXISTS "Users can manage own devices" ON user_devices;
CREATE POLICY "Users can manage own devices"
  ON user_devices FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Settings
DROP POLICY IF EXISTS "Admin can manage settings" ON settings;
DROP POLICY IF EXISTS "Active admin manages settings" ON settings;
CREATE POLICY "Active admin manages settings"
  ON settings FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());
DROP POLICY IF EXISTS "Authenticated users can read settings" ON settings;
DROP POLICY IF EXISTS "Active users can read settings" ON settings;
CREATE POLICY "Active users can read settings"
  ON settings FOR SELECT TO authenticated
  USING (public.is_active_user());

-- Labels & task_labels: readable by active users, managed by admins
DROP POLICY IF EXISTS "Active users read labels" ON labels;
CREATE POLICY "Active users read labels"
  ON labels FOR SELECT TO authenticated
  USING (public.is_active_user());
DROP POLICY IF EXISTS "Active admin manages labels" ON labels;
CREATE POLICY "Active admin manages labels"
  ON labels FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Active users read task labels" ON task_labels;
CREATE POLICY "Active users read task labels"
  ON task_labels FOR SELECT TO authenticated
  USING (public.is_active_user());
DROP POLICY IF EXISTS "Task-access users manage task labels" ON task_labels;
CREATE POLICY "Task-access users manage task labels"
  ON task_labels FOR ALL TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_labels.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_labels.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  );

-- Subtasks: active users only, task-scoped access
DROP POLICY IF EXISTS "Access subtasks via task access" ON task_subtasks;
CREATE POLICY "Access subtasks via task access"
  ON task_subtasks FOR ALL
  TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_subtasks.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_subtasks.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid()
          )
        )
    )
  );

-- Activity: readable via task/project access; writes via service role only
DROP POLICY IF EXISTS "Read accessible activity" ON activity;
CREATE POLICY "Read accessible activity"
  ON activity FOR SELECT
  TO authenticated
  USING (
    public.is_active_user()
    AND (
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
      OR public.is_active_admin()
    )
  );
DROP POLICY IF EXISTS "Service role writes activity" ON activity;
CREATE POLICY "Service role writes activity"
  ON activity FOR INSERT
  TO service_role
  WITH CHECK (true);

-- admin_audit_log
DROP POLICY IF EXISTS "Active admins can read admin audit log" ON admin_audit_log;
CREATE POLICY "Active admins can read admin audit log"
  ON admin_audit_log FOR SELECT
  TO authenticated
  USING (public.is_active_admin());
DROP POLICY IF EXISTS "Active admins can write admin audit log" ON admin_audit_log;
CREATE POLICY "Active admins can write admin audit log"
  ON admin_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_admin() AND actor_id = auth.uid());

-- ──────────────────────────────────────────────
-- 5. Lifecycle RPC — last-admin protection (re-assert idempotently)
-- ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_audit_action') THEN
    CREATE TYPE admin_audit_action AS ENUM (
      'APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE', 'ROLE_CHANGED',
      'TASK_DELETED', 'PROJECT_ARCHIVED', 'CLIENT_ARCHIVED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  target_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action admin_audit_action NOT NULL,
  previous_status profile_status,
  next_status profile_status,
  previous_role user_role,
  next_role user_role,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_profile_id, created_at DESC);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.manage_profile_lifecycle(
  target_id UUID,
  requested_action admin_audit_action,
  requested_role user_role DEFAULT NULL
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  target profiles%ROWTYPE;
  active_admin_count INTEGER;
  previous_status profile_status;
  previous_role user_role;
  next_status profile_status;
  next_role user_role;
BEGIN
  IF NOT public.is_active_admin(actor) THEN
    RAISE EXCEPTION 'Only active admins may manage profiles';
  END IF;

  SELECT * INTO target
  FROM public.profiles
  WHERE id = target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  next_status := target.status;
  next_role := target.role;
  previous_status := target.status;
  previous_role := target.role;

  CASE requested_action
    WHEN 'APPROVE' THEN
      IF requested_role IS NULL THEN
        RAISE EXCEPTION 'An approval role is required';
      END IF;
      next_status := 'ACTIVE';
      next_role := requested_role;
    WHEN 'REJECT' THEN
      next_status := 'SUSPENDED';
      next_role := NULL;
    WHEN 'SUSPEND' THEN
      next_status := 'SUSPENDED';
    WHEN 'REACTIVATE' THEN
      IF target.role IS NULL THEN
        RAISE EXCEPTION 'A role is required before reactivation';
      END IF;
      next_status := 'ACTIVE';
    WHEN 'ROLE_CHANGED' THEN
      IF requested_role IS NULL THEN
        RAISE EXCEPTION 'A new role is required';
      END IF;
      next_role := requested_role;
    ELSE
      RAISE EXCEPTION 'Unsupported profile action';
  END CASE;

  -- Protect the last active admin (§8)
  IF target.role = 'ADMIN'
     AND target.status = 'ACTIVE'
      AND (next_status IS DISTINCT FROM 'ACTIVE' OR next_role IS DISTINCT FROM 'ADMIN') THEN
    SELECT count(*) INTO active_admin_count
    FROM public.profiles
    WHERE status = 'ACTIVE' AND role = 'ADMIN';

    IF active_admin_count <= 1 THEN
      RAISE EXCEPTION 'Create another active admin before removing the last active admin';
    END IF;
  END IF;

  UPDATE public.profiles
  SET status = next_status,
      role = next_role,
      active = next_status = 'ACTIVE',
      approved_at = CASE
        WHEN next_status = 'ACTIVE' THEN COALESCE(approved_at, now())
        ELSE approved_at
      END,
      approved_by = CASE
        WHEN requested_action = 'APPROVE' THEN actor
        ELSE approved_by
      END
  WHERE id = target.id
  RETURNING * INTO target;

  INSERT INTO public.admin_audit_log (
    actor_id, target_profile_id, action,
    previous_status, next_status, previous_role, next_role, detail
  ) VALUES (
    actor, target.id, requested_action,
    previous_status, next_status, previous_role, next_role,
    CASE requested_action
      WHEN 'ROLE_CHANGED' THEN format('%s -> %s', previous_role, next_role)
      ELSE NULL
    END
  );

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_profile_lifecycle(UUID, admin_audit_action, user_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_profile_lifecycle(UUID, admin_audit_action, user_role) TO authenticated, service_role;

-- ──────────────────────────────────────────────
-- 6. FIXED activity triggers (the 42P01 bug).
--    Trigger functions must reference NEW/OLD — the previous
--    versions selected from undeclared aliases (c/a/p), so EVERY
--    insert into task_comments, task_attachments and payments
--    failed with "missing FROM-clause entry for table".
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_comment_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_project_id UUID;
BEGIN
  SELECT project_id INTO v_project_id FROM tasks WHERE id = NEW.task_id;
  INSERT INTO activity (task_id, project_id, actor_id, type, detail)
  VALUES (NEW.task_id, v_project_id, NEW.user_id, 'COMMENT_ADDED', LEFT(NEW.comment, 120));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION log_attachment_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_project_id UUID;
  v_row task_attachments%ROWTYPE;
BEGIN
  v_row := COALESCE(NEW, OLD);
  SELECT project_id INTO v_project_id FROM tasks WHERE id = v_row.task_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    VALUES (v_row.task_id, v_project_id, v_row.uploaded_by, 'ATTACHMENT_ADDED', v_row.file_name);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO activity (task_id, project_id, actor_id, type, detail)
    VALUES (v_row.task_id, v_project_id, v_row.uploaded_by, 'ATTACHMENT_DELETED', v_row.file_name);
  END IF;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION log_payment_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_project_id UUID;
BEGIN
  SELECT project_id INTO v_project_id FROM tasks WHERE id = NEW.task_id;
  INSERT INTO activity (task_id, project_id, actor_id, type, detail)
  VALUES (NEW.task_id, v_project_id, NEW.paid_by, 'PAYMENT_PAID', NEW.amount::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION log_task_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_client_id UUID;
BEGIN
  SELECT client_id INTO v_client_id FROM projects WHERE id = NEW.project_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity (task_id, project_id, client_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, v_client_id, COALESCE(NEW.created_by, NEW.assigned_to), 'TASK_CREATED', NEW.title);

    IF NEW.assigned_to IS NOT NULL THEN
      INSERT INTO activity (task_id, project_id, client_id, actor_id, type, detail)
      VALUES (NEW.id, NEW.project_id, v_client_id, NEW.created_by, 'TASK_ASSIGNED', NEW.title);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO activity (task_id, project_id, client_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, v_client_id, auth.uid(), 'STATUS_CHANGED', NEW.status::text);
    IF NEW.status = 'COMPLETED' THEN
      INSERT INTO activity (task_id, project_id, client_id, actor_id, type, detail)
      VALUES (NEW.id, NEW.project_id, v_client_id, auth.uid(), 'TASK_COMPLETED', NEW.title);
    END IF;
  END IF;

  IF NEW.deadline IS DISTINCT FROM OLD.deadline THEN
    INSERT INTO activity (task_id, project_id, client_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, v_client_id, auth.uid(), 'DEADLINE_CHANGED', NULL);
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO activity (task_id, project_id, client_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, v_client_id, auth.uid(), 'PRIORITY_CHANGED', NEW.priority::text);
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO activity (task_id, project_id, client_id, actor_id, type, detail)
    VALUES (NEW.id, NEW.project_id, v_client_id, auth.uid(), 'TASK_ASSIGNED', NEW.title);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ──────────────────────────────────────────────
-- 7. Invitations (§9–12) — admin invites by email; the invited
--    person accepts by signing in with a matching Google account.
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'EMPLOYEE',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '14 days',
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(lower(email));
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active admins manage invitations" ON invitations;
CREATE POLICY "Active admins manage invitations"
  ON invitations FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- Acceptance runs server-side via the service-role client (the
-- invitee cannot read the invitation row directly).
DROP POLICY IF EXISTS "Service role manages invitations" ON invitations;
CREATE POLICY "Service role manages invitations"
  ON invitations FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ──────────────────────────────────────────────
-- 8. Push subscriptions (§20) — one row per browser/device.
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users manage own push subscriptions"
  ON push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role reads push subscriptions" ON push_subscriptions;
CREATE POLICY "Service role reads push subscriptions"
  ON push_subscriptions FOR SELECT TO service_role
  USING (true);

-- ──────────────────────────────────────────────
-- 9. Realtime publication additions (idempotent)
-- ──────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity', 'task_subtasks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;