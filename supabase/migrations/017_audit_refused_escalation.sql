-- ============================================================
-- Taskora — Migration 017
-- Fix: refused privilege escalations are never audited.
--
-- ── The bug ───────────────────────────────────────────────────
--
-- Phase 3 probed the live database with a real signed-in MANAGER
-- attempting to suspend a SUPER_ADMIN. The call was correctly
-- refused — and no admin_audit_log row was written, despite
-- migration 014 claiming it would be:
--
--   audit rows before: 7
--   rpc error: Only a super admin may manage a manager or super admin
--   audit rows after:  7      <-- unchanged
--
-- Two compounding causes:
--
-- 1. ROLLBACK. The INSERT sits inside a BEGIN ... EXCEPTION block,
--    and the RAISE EXCEPTION that follows it aborts the enclosing
--    subtransaction. Postgres rolls the subtransaction back — taking
--    the audit row with it. The audit could never persist, by
--    construction.
--
-- 2. RLS. "Super admins can write admin audit log" allows INSERT
--    only when is_active_admin(). The very caller whose attempt we
--    want to record — a manager — is not an active admin, so the
--    insert was rejected by policy. The EXCEPTION block swallowed
--    that error too, which is why the failure was invisible.
--
-- ── The fix ───────────────────────────────────────────────────
--
-- A dedicated SECURITY DEFINER logger, called before the RAISE. It
-- bypasses RLS (so a manager's attempt can be recorded) and lives
-- outside any exception block (so the row survives the raise).
--
-- This is deliberately the smallest change that makes the documented
-- behaviour true: the audit row is now written and retained.
--
-- Idempotent: CREATE OR REPLACE throughout.
--
-- Run AFTER 016_calendar_ownership.sql. Order: 001 → 017.
--
-- ────────────────────────────────────────────────────────────
-- DOWN MIGRATION
--
--   DROP FUNCTION IF EXISTS public.log_refused_escalation(UUID, UUID, admin_audit_action, profile_status, user_role, user_role, TEXT);
--   -- then restore the 014 definition of manage_profile_lifecycle().
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. The logger.
--
-- SECURITY DEFINER so it can write the audit row regardless of the
-- caller's role — the whole point is to record attempts made by
-- people who are NOT super admins.
--
-- search_path is pinned so a hostile schema cannot shadow the tables.
--
-- Restricted to the service_role and to the function owner, so it
-- cannot be called directly by an authenticated user to forge audit
-- entries. Only manage_profile_lifecycle() should reach it.
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_refused_escalation(
  p_actor_id UUID,
  p_target_id UUID,
  p_action admin_audit_action,
  p_previous_status profile_status,
  p_next_status profile_status,
  p_previous_role user_role,
  p_next_role user_role,
  p_detail TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_audit_log (
    actor_id, target_profile_id, action,
    previous_status, next_status, previous_role, next_role, detail
  ) VALUES (
    p_actor_id, p_target_id, p_action,
    p_previous_status, p_next_status, p_previous_role, p_next_role, p_detail
  );
EXCEPTION WHEN OTHERS THEN
  -- An audit failure must never mask the authorization error that
  -- follows. Swallowed on purpose, and logged to the server log so it
  -- is at least visible to an operator.
  RAISE WARNING '[audit] could not record refused escalation: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.log_refused_escalation(UUID, UUID, admin_audit_action, profile_status, profile_status, user_role, user_role, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_refused_escalation(UUID, UUID, admin_audit_action, profile_status, profile_status, user_role, user_role, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_refused_escalation(UUID, UUID, admin_audit_action, profile_status, profile_status, user_role, user_role, TEXT) TO service_role;

-- ──────────────────────────────────────────────
-- 2. Call it from the RPC, outside any exception block.
--
-- Previously:
--
--   BEGIN
--     INSERT INTO admin_audit_log ... ;   -- rolled back by the RAISE below
--   EXCEPTION WHEN OTHERS THEN NULL; END;
--   RAISE EXCEPTION 'Only a super admin may ...';
--
-- Now the write happens in its own transaction-scope statement, so
-- the subsequent RAISE cannot undo it.
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
    -- Record the attempt first, in its own statement, so the RAISE
    -- below cannot roll it back. See migration 017 for why this is
    -- not wrapped in a BEGIN ... EXCEPTION block.
    PERFORM public.log_refused_escalation(
      actor,
      target.id,
      'ROLE_REQUIRES_SUPER_ADMIN',
      target.status,
      target.status,
      target.role,
      target.role,
      format('%s attempted %s on a %s account', actor_role, requested_action, target.role)
    );

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