-- Taskora — Migration 007
-- Replace role-only administrative policies with status-aware policies.

DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'Admin %'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$$;

CREATE POLICY "Active admin manages clients"
  ON clients FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages projects"
  ON projects FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages project members"
  ON project_members FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages project resources"
  ON project_resources FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages tasks"
  ON tasks FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages task comments"
  ON task_comments FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages task attachments"
  ON task_attachments FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages payments"
  ON payments FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Active admin manages settings"
  ON settings FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- Pending and suspended users retain only their own profile read, never work data.
DROP POLICY IF EXISTS "Employees can read active clients" ON clients;
CREATE POLICY "Active users can read active clients"
  ON clients FOR SELECT TO authenticated
  USING (public.is_active_user() AND active = true);

DROP POLICY IF EXISTS "Employees can read own projects" ON projects;
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

DROP POLICY IF EXISTS "Employees can read assigned tasks" ON tasks;
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
CREATE POLICY "Active employees can update own task status"
  ON tasks FOR UPDATE TO authenticated
  USING (public.is_active_user() AND assigned_to = auth.uid())
  WITH CHECK (public.is_active_user() AND assigned_to = auth.uid());

DROP POLICY IF EXISTS "Employees can read own task payments" ON payments;
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

DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Active users can read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Active users can update own notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid())
  WITH CHECK (public.is_active_user() AND user_id = auth.uid());
