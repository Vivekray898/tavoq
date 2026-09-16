-- Taskora — Migration 006
-- Atomic admin profile lifecycle changes and audit logging.

CREATE TYPE admin_audit_action AS ENUM (
  'APPROVE',
  'REJECT',
  'SUSPEND',
  'REACTIVATE',
  'ROLE_CHANGED',
  'TASK_DELETED',
  'PROJECT_ARCHIVED',
  'CLIENT_ARCHIVED'
);

CREATE TABLE admin_audit_log (
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

CREATE INDEX idx_admin_audit_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit_log(target_profile_id, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active admins can read admin audit log"
  ON admin_audit_log FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

CREATE POLICY "Active admins can write admin audit log"
  ON admin_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_admin() AND actor_id = auth.uid());

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
    actor_id,
    target_profile_id,
    action,
    previous_status,
    next_status,
    previous_role,
    next_role,
    detail
  ) VALUES (
    actor,
    target.id,
    requested_action,
    previous_status,
    next_status,
    previous_role,
    next_role,
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
