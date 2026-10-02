-- ============================================================
-- Taskora — Migration 013
-- Three-role model: SUPER_ADMIN / MANAGER / EMPLOYEE.
--
-- Idempotent: safe to run repeatedly, and safe on a database where
-- 001–012 have all been applied. Existing admins become SUPER_ADMIN
-- and keep every capability they had. No row is dropped or rewritten
-- beyond that role remap.
--
-- Run AFTER 012_google_calendar_integration.sql. Order: 001 → 013.
--
-- ────────────────────────────────────────────────────────────
-- DOWN MIGRATION (run manually to revert; not automatic)
--
--   BEGIN;
--
--   -- Restore the single-admin model.
--   DROP FUNCTION IF EXISTS public.can_manage_project(UUID);
--   DROP FUNCTION IF EXISTS public.is_active_staff(UUID);
--   DROP FUNCTION IF EXISTS public.is_active_manager(UUID);
--
--   ALTER TYPE public.user_role RENAME VALUE 'SUPER_ADMIN' TO 'ADMIN';
--   ALTER TYPE public.user_role RENAME VALUE 'MANAGER' TO 'EMPLOYEE'; -- only valid
--   -- if no MANAGER rows exist; otherwise those rows must be mapped
--   -- to EMPLOYEE first, since Postgres cannot remove an enum value:
--   --   UPDATE profiles SET role = 'EMPLOYEE' WHERE role = 'MANAGER';
--   --   UPDATE invitations SET role = 'EMPLOYEE' WHERE role = 'MANAGER';
--
--   -- Re-create the pre-013 helper and re-apply the policies from
--   -- migration 008 (they are all replaced by this file).
--   -- ...
--
--   COMMIT;
--
-- NOTE: reverting is lossy by nature — a MANAGER cannot be mapped back
-- to a distinct former role, and roles demoted to EMPLOYEE stay that
-- way. Take a backup before reverting in production.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. Extend the enum
--
-- Deliberately using RENAME VALUE rather than dropping and
-- recreating the type. Recreating would break all four dependent
-- columns (profiles.role, invitations.role,
-- admin_audit_log.previous_role, admin_audit_log.next_role) AND the
-- manage_profile_lifecycle(UUID, admin_audit_action, user_role)
-- signature, each of which would have to be rebuilt and re-granted.
-- Renaming the value in place keeps every dependent object valid and
-- preserves the existing rows with no data movement.
--
-- ADD VALUE cannot run inside a transaction block on older Postgres,
-- which is why the guard below exists: on a server where it would
-- fail, apply steps 1a/1b manually before running the rest.
-- ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'MANAGER', 'EMPLOYEE');
  END IF;
END $$;

-- 1a. ADMIN -> SUPER_ADMIN (no-op once already renamed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'ADMIN'
  ) THEN
    ALTER TYPE public.user_role RENAME VALUE 'ADMIN' TO 'SUPER_ADMIN';
  END IF;
END $$;

-- 1b. Add the manager tier.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'MANAGER'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'MANAGER';
  END IF;
END $$;

-- 1c. The retired ADMIN label is gone after 1a. Every row that held it
-- now reads SUPER_ADMIN, so nothing needs a data UPDATE. This is the
-- explicit statement of that invariant, and it also repairs any
-- database where the rename was applied to the type but not to rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'ADMIN'
  ) THEN
    RAISE EXCEPTION
      'user_role still contains an ADMIN label — rename it to SUPER_ADMIN before continuing';
  END IF;
END $$;

-- ──────────────────────────────────────────────
-- 2. Authorization helpers
--
-- is_active_admin() KEEPS ITS NAME and now means "active super
-- admin". Every policy already keyed on it (clients, settings,
-- labels, audit log, invitations) therefore becomes super-admin-only
-- automatically, which is exactly the intent: those are the
-- configuration and destructive surfaces managers must not reach.
--
-- Names are deliberately unchanged so migrations 002/004/007/008 stay
-- valid history and a rollback does not have to unwind them.
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

-- Manager tier: active AND role = MANAGER. Note this is NOT
-- "at least manager" — is_active_manager() is deliberately exact so
-- it can gate manager-specific behaviour, and is_active_staff() is
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
--   super admin            -> always
--   manager                -> only as a member of that project
--   anyone else            -> never
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
-- 3. Clients
-- Managers manage clients. Hard delete stays super-admin only, which
-- the existing FOR ALL policy already guarantees because
-- is_active_admin() now means super admin; re-asserted here so the
-- intent is explicit and survives a future edit to the delete path.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages clients" ON clients;
CREATE POLICY "Active staff manages clients"
  ON clients FOR ALL TO authenticated
  USING (public.is_active_staff())
  WITH CHECK (public.is_active_staff());

-- Hard delete is the one irreversible client action.
DROP POLICY IF EXISTS "Super admin deletes clients" ON clients;
CREATE POLICY "Super admin deletes clients"
  ON clients FOR DELETE TO authenticated
  USING (public.is_active_admin());

-- ──────────────────────────────────────────────
-- 4. Projects
-- Staff manage projects; a manager only within their own projects.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages projects" ON projects;
CREATE POLICY "Active staff manages own projects"
  ON projects FOR ALL TO authenticated
  USING (public.can_manage_project(id))
  WITH CHECK (public.can_manage_project(id));

-- Hard delete: super admin only, even inside their own projects.
DROP POLICY IF EXISTS "Super admin deletes projects" ON projects;
CREATE POLICY "Super admin deletes projects"
  ON projects FOR DELETE TO authenticated
  USING (public.is_active_admin());

-- ──────────────────────────────────────────────
-- 5. Project members — managers only for their own projects.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages project members" ON project_members;
CREATE POLICY "Active staff manages own project members"
  ON project_members FOR ALL TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

-- ──────────────────────────────────────────────
-- 6. Project resources — managers only for their own projects.
-- ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Active admin manages project resources" ON project_resources;
CREATE POLICY "Active staff manages own project resources"
  ON project_resources FOR ALL TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

-- ──────────────────────────────────────────────
-- 7. Tasks
-- Staff act on tasks in their own projects. The FOR ALL policy covers
-- insert/update; the hard-delete policy below re-imposes the
-- super-admin-only rule that FOR ALL would otherwise widen.
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
-- 8. Task comments / attachments / labels / subtasks
-- These are all reachable when the parent task is, so a manager gains
-- access exactly where they gained task access.
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
-- Payments are org-wide by nature (payroll is not per-project), so
-- there is no project scoping here.
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
-- The role ceiling is enforced here rather than in the policy body,
-- because the policy sees the row being written and can simply reject
-- a manager-issued invite carrying a privileged role.
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
-- 12. Audit log — readable by staff (it is an operational record),
-- writable only by super admin, matching who can actually change a
-- role. Managers appear in it as actors; they cannot forge entries.
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
-- Recorded when a non-super-admin attempts to touch a privileged
-- target, so the attempt is auditable rather than merely rejected.
-- ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_audit_action' AND e.enumlabel = 'ROLE_REQUIRES_SUPER_ADMIN'
  ) THEN
    ALTER TYPE public.admin_audit_action ADD VALUE 'ROLE_REQUIRES_SUPER_ADMIN';
  END IF;
END $$;

-- ──────────────────────────────────────────────
-- 14. Profile lifecycle RPC — role-change authority.
--
-- The critical property: a MANAGER can never grant MANAGER or
-- SUPER_ADMIN, and can never act on a target that already holds
-- either. That second rule is what stops a manager from suspending
-- a peer or a super admin, which the pre-013 check (target is
-- privileged AND caller is staff) did not cover.
--
-- APPROVE is gated on the REQUESTED role, not just the action name,
-- because it writes profiles.role as well as profiles.status.
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

  -- A manager must not be able to demote a super admin sideways, and
  -- must not be able to leave an account with no owner.
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
-- Previously only a super admin could change anyone's role/status.
-- A manager now legitimately changes an employee's status, so the
-- trigger has to permit that — while still blocking self-edits, which
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