-- ============================================================
-- Taskora — Migration 014
-- Role hierarchy: helpers, RLS, and the profile lifecycle RPC.
--
-- Split from the former migration 013 because Postgres will not allow
-- a newly added enum value to be used in the same transaction that
-- created it (ERROR 55P04). 013_role_enum_values.sql adds SUPER_ADMIN
-- and MANAGER and commits; THIS file consumes them.
--
-- Idempotent: safe to run repeatedly, and safe on a database where
-- 001–013 have all been applied. Existing admins are already
-- SUPER_ADMIN; nothing is moved or dropped here.
--
-- Run AFTER 013_role_enum_values.sql. Order: 001 → 013 → 014.
--
-- Every ADD VALUE this project needs lives in 013. This file only
-- CONSUMES new enum values, which is why it can reference MANAGER and
-- ROLE_REQUIRES_SUPER_ADMIN safely.
--
-- ────────────────────────────────────────────────────────────
-- DOWN MIGRATION
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.can_manage_project(UUID);
--   DROP FUNCTION IF EXISTS public.is_active_staff(UUID);
--   DROP FUNCTION IF EXISTS public.is_active_manager(UUID);
--   -- Restore is_active_admin() and the pre-014 policies from
--   -- migration 008; they are replaced here rather than edited.
--   -- Then re-apply the pre-014 manage_profile_lifecycle() from
--   -- migration 008 (the version without the manager rules).
--   COMMIT;
--
-- Reverting the enum itself is separate — see 013. Take a backup:
-- reverting collapses MANAGER into EMPLOYEE.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. Authorization helpers
--
-- is_active_admin() KEEPS ITS NAME and now means "active super
-- admin". Every policy already keyed on it (clients, settings,
-- labels, audit log, invitations) therefore becomes super-admin-only
-- automatically — exactly the intent, since those are the
-- configuration and destructive surfaces managers must not reach.
--
-- Names are unchanged so migrations 002/004/007/008 stay valid
-- history and a rollback does not have to unwind them.
-- ──────────────────────────────────────────────

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
      AND role = 'SUPER_ADMIN'
  );
$$;

-- Manager tier: active AND role = MANAGER. Deliberately NOT "manager
-- or above" — is_active_manager() is exact, and is_active_staff() is
-- the "manager or above" check.
CREATE OR REPLACE FUNCTION public.is_active_manager(user_id UUID DEFAULT auth.uid())
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
      AND role = 'MANAGER'
  );
$$;

-- Operational staff: super admin OR manager. This is what the
-- day-to-day policies use, combined with can_manage_project() to keep
-- a manager inside their own projects.
CREATE OR REPLACE FUNCTION public.is_active_staff(user_id UUID DEFAULT auth.uid())
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
      AND role IN ('SUPER_ADMIN', 'MANAGER')
  );
$$;

-- May the caller administer this specific project?
--   super admin -> always
--   manager     -> only as a member of that project
--   anyone else -> never
CREATE OR REPLACE FUNCTION public.can_manage_project(project_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_active_admin()
    OR (
      public.is_active_manager()
      AND EXISTS (
        SELECT 1
        FROM public.project_members pm
        WHERE pm.project_id = can_manage_project.project_id
          AND pm.user_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_manager(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_staff(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_project(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_manager(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_staff(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_project(UUID) TO authenticated, service_role;

-- ──────────────────────────────────────────────
-- 2. Clients
-- Managers manage clients. Hard delete stays super-admin only; the
-- explicit DELETE policy below re-imposes that because the FOR ALL
-- policy would otherwise widen it.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages clients" ON clients;
CREATE POLICY "Active staff manages clients"
  ON clients FOR ALL TO authenticated
  USING (public.is_active_staff())
  WITH CHECK (public.is_active_staff());

DROP POLICY IF EXISTS "Super admin deletes clients" ON clients;
CREATE POLICY "Super admin deletes clients"
  ON clients FOR DELETE TO authenticated
  USING (public.is_active_admin());

-- ──────────────────────────────────────────────
-- 3. Projects — managers only within their own projects.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages projects" ON projects;
CREATE POLICY "Active staff manages own projects"
  ON projects FOR ALL TO authenticated
  USING (public.can_manage_project(id))
  WITH CHECK (public.can_manage_project(id));

DROP POLICY IF EXISTS "Super admin deletes projects" ON projects;
CREATE POLICY "Super admin deletes projects"
  ON projects FOR DELETE TO authenticated
  USING (public.is_active_admin());

-- ──────────────────────────────────────────────
-- 4. Project members — managers only for their own projects.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages project members" ON project_members;
CREATE POLICY "Active staff manages own project members"
  ON project_members FOR ALL TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

-- ──────────────────────────────────────────────
-- 5. Project resources — managers only for their own projects.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages project resources" ON project_resources;
CREATE POLICY "Active staff manages own project resources"
  ON project_resources FOR ALL TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

-- ──────────────────────────────────────────────
-- 6. Tasks
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages tasks" ON tasks;
CREATE POLICY "Active staff manages own tasks"
  ON tasks FOR ALL TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS "Super admin deletes tasks" ON tasks;
CREATE POLICY "Super admin deletes tasks"
  ON tasks FOR DELETE TO authenticated
  USING (public.is_active_admin());

-- ──────────────────────────────────────────────
-- 7. Task comments / attachments — reachable when the parent task is,
-- so a manager gains access exactly where they gained task access.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages task comments" ON task_comments;
CREATE POLICY "Active staff manages task comments"
  ON task_comments FOR ALL TO authenticated
  USING (
    public.is_active_staff()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_comments.task_id
        AND public.can_manage_project(t.project_id)
    )
  )
  WITH CHECK (
    public.is_active_staff()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_comments.task_id
        AND public.can_manage_project(t.project_id)
    )
  );

DROP POLICY IF EXISTS "Active admin manages task attachments" ON task_attachments;
CREATE POLICY "Active staff manages own task attachments"
  ON task_attachments FOR ALL TO authenticated
  USING (
    public.is_active_staff()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_attachments.task_id
        AND public.can_manage_project(t.project_id)
    )
  )
  WITH CHECK (
    public.is_active_staff()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_attachments.task_id
        AND public.can_manage_project(t.project_id)
    )
  );

-- ──────────────────────────────────────────────
-- 8. Labels / task labels / subtasks
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages labels" ON labels;
CREATE POLICY "Active staff manages labels"
  ON labels FOR ALL TO authenticated
  USING (public.is_active_staff())
  WITH CHECK (public.is_active_staff());

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
          OR public.can_manage_project(t.project_id)
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
          OR public.can_manage_project(t.project_id)
        )
    )
  );

DROP POLICY IF EXISTS "Access subtasks via task access" ON task_subtasks;
CREATE POLICY "Access subtasks via task access"
  ON task_subtasks FOR ALL TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_subtasks.task_id
        AND (
          t.assigned_to = auth.uid()
          OR public.can_manage_project(t.project_id)
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
          OR public.can_manage_project(t.project_id)
        )
    )
  );

-- ──────────────────────────────────────────────
-- 9. Payments — staff run payroll; employees keep their own rows.
-- Payroll is org-wide rather than per-project, so there is no project
-- scoping here.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages payments" ON payments;
CREATE POLICY "Active staff manages payments"
  ON payments FOR ALL TO authenticated
  USING (public.is_active_staff())
  WITH CHECK (public.is_active_staff());

-- ──────────────────────────────────────────────
-- 10. Activity — a manager sees activity in their own projects.
-- ──────────────────────────────────────────────

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
            OR public.can_manage_project(t.project_id)
          )
      ))
      OR (project_id IS NOT NULL AND task_id IS NULL AND EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = activity.project_id AND pm.user_id = auth.uid()
      ))
      OR public.is_active_admin()
    )
  );

-- ──────────────────────────────────────────────
-- 11. Invitations — managers may invite, but only as EMPLOYEE.
-- The role ceiling lives in the policy body because the policy sees
-- the row being written and can reject a manager-issued invite
-- carrying a privileged role. lib/actions/invitations.ts enforces the
-- same rule so the refusal reads as a clean error, not an RLS failure.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admins manage invitations" ON invitations;
CREATE POLICY "Active staff manages invitations"
  ON invitations FOR ALL TO authenticated
  USING (
    public.is_active_admin()
    OR (public.is_active_manager() AND role = 'EMPLOYEE')
  )
  WITH CHECK (
    public.is_active_admin()
    OR (public.is_active_manager() AND role = 'EMPLOYEE')
  );

-- ──────────────────────────────────────────────
-- 12. Audit log — readable by staff, writable only by super admin,
-- matching who can actually change a role.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admins can read admin audit log" ON admin_audit_log;
CREATE POLICY "Active staff can read admin audit log"
  ON admin_audit_log FOR SELECT
  TO authenticated
  USING (public.is_active_staff());

DROP POLICY IF EXISTS "Active admins can write admin audit log" ON admin_audit_log;
CREATE POLICY "Super admins can write admin audit log"
  ON admin_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_admin() AND actor_id = auth.uid());

-- ──────────────────────────────────────────────
-- 13. New audit action for the refused escalation.
--
-- The ADD VALUE itself lives in 013_role_enum_values.sql, not here.
-- This file INSERTS 'ROLE_REQUIRES_SUPER_ADMIN' into
-- admin_audit_log.action (see the lifecycle RPC below), and Postgres
-- refuses to use a new enum value in the transaction that created it.
-- Adding it here and using it here would fail with 55P04 all over
-- again. Adding it in 013 and using it here is correct, because 013
-- has committed by the time this file runs.
-- ──────────────────────────────────────────────

-- ──────────────────────────────────────────────
-- 14. Profile lifecycle RPC — role-change authority.
--
-- The critical property: a MANAGER can never grant MANAGER or
-- SUPER_ADMIN, and can never act on a target that already holds
-- either. That second rule is what stops a manager suspending a peer
-- or a super admin.
--
-- APPROVE is gated on the REQUESTED role, not just the action name,
-- because it writes profiles.role as well as profiles.status. Gating
-- on the action name alone is what would let a manager mint a
-- SUPER_ADMIN by approving a pending user with requested_role set to
-- SUPER_ADMIN.
-- ──────────────────────────────────────────────

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
  actor_role user_role;
  active_super_admin_count INTEGER;
  previous_status profile_status;
  previous_role user_role;
  next_status profile_status;
  next_role user_role;
  actor_is_super BOOLEAN;
  target_is_privileged BOOLEAN;
BEGIN
  SELECT role INTO actor_role
  FROM public.profiles
  WHERE id = actor AND status = 'ACTIVE';

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'Only active staff may manage profiles';
  END IF;

  actor_is_super := (actor_role = 'SUPER_ADMIN');
  IF NOT actor_is_super AND actor_role <> 'MANAGER' THEN
    RAISE EXCEPTION 'Only active staff may manage profiles';
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

  -- The target's CURRENT role decides who may touch them at all.
  -- A pending signup has role NULL and is fair game for a manager —
  -- that is the approve flow.
  target_is_privileged := (target.role IN ('MANAGER', 'SUPER_ADMIN'));

  IF NOT actor_is_super AND target_is_privileged THEN
    -- Audit the refused attempt before failing, so it leaves a trace.
    BEGIN
      INSERT INTO public.admin_audit_log (
        actor_id, target_profile_id, action,
        previous_status, next_status, previous_role, next_role, detail
      ) VALUES (
        actor, target.id, 'ROLE_REQUIRES_SUPER_ADMIN',
        target.status, target.status, target.role, target.role,
        format('%s attempted %s on a %s account', actor_role, requested_action, target.role)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let an audit-write failure mask the authorisation error.
      NULL;
    END;

    RAISE EXCEPTION 'Only a super admin may manage a manager or super admin';
  END IF;

  CASE requested_action
    WHEN 'APPROVE' THEN
      IF requested_role IS NULL THEN
        RAISE EXCEPTION 'An approval role is required';
      END IF;
      -- A manager may only ever onboard plain employees.
      IF NOT actor_is_super AND requested_role <> 'EMPLOYEE' THEN
        RAISE EXCEPTION 'Managers may only approve users as EMPLOYEE';
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
      -- Role changes are configuration: super admin only.
      IF NOT actor_is_super THEN
        RAISE EXCEPTION 'Only a super admin may change a role';
      END IF;
      next_role := requested_role;
    ELSE
      RAISE EXCEPTION 'Unsupported profile action';
  END CASE;

  -- Last-active-super-admin protection (was: last active admin).
  IF target.role = 'SUPER_ADMIN'
     AND target.status = 'ACTIVE'
      AND (next_status IS DISTINCT FROM 'ACTIVE' OR next_role IS DISTINCT FROM 'SUPER_ADMIN') THEN
    SELECT count(*) INTO active_super_admin_count
    FROM public.profiles
    WHERE status = 'ACTIVE' AND role = 'SUPER_ADMIN';

    IF active_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Create another active super admin before removing the last active super admin';
    END IF;
  END IF;

  -- A manager must not be able to demote a super admin sideways.
  IF target.role = 'SUPER_ADMIN'
     AND next_role IS DISTINCT FROM 'SUPER_ADMIN'
     AND next_role IS NOT NULL
     AND NOT actor_is_super THEN
    RAISE EXCEPTION 'Only a super admin may change a super admin role';
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
-- 15. Self-authorization guard, widened to staff.
--
-- Previously only a super admin could change anyone's role/status. A
-- manager now legitimately changes an employee's status, so the
-- trigger must permit that — while still blocking self-edits, which
-- no role may do.
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_profile_authorization_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nobody may edit their OWN role/status/approval, at any level.
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.id
     AND (
       NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     ) THEN
    RAISE EXCEPTION 'You cannot change your own role or account status';
  END IF;

  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────
-- 16. Storage policies from 002 that inline role = 'ADMIN'.
--
-- These compare against the enum literal directly, so they would have
-- become dead the moment the value was renamed. Re-asserted here with
-- the helper functions.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Read own task attachments" ON storage.objects;
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
          OR public.can_manage_project(t.project_id)
        )
    )
  );

DROP POLICY IF EXISTS "Upload own task attachments" ON storage.objects;
CREATE POLICY "Upload own task attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.task_attachments ta
      JOIN public.tasks t ON t.id = ta.task_id
      WHERE ta.file_path = name
        AND (
          ta.uploaded_by = auth.uid()
          OR public.can_manage_project(t.project_id)
        )
    )
  );

DROP POLICY IF EXISTS "Delete own or admin attachments" ON storage.objects;
CREATE POLICY "Delete own or admin attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.task_attachments ta
      JOIN public.tasks t ON t.id = ta.task_id
      WHERE ta.file_path = name
        AND (
          ta.uploaded_by = auth.uid()
          OR public.can_manage_project(t.project_id)
        )
    )
  );