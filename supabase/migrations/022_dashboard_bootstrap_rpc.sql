-- ─────────────────────────────────────────────────────────────────────────
-- Taskora — Migration 022
-- Single-round-trip admin dashboard.
--
-- WHY THIS EXISTS
-- getAdminDashboard() issued nine PostgREST queries across four tables
-- (tasks x6, profiles, payments, task_comments). The client saw one
-- request, but the database served nine, each re-checking RLS, each
-- re-evaluating the same day boundaries. This collapses all nine into
-- one function call.
--
-- WHY SECURITY INVOKER (the default) AND NOT SECURITY DEFINER
-- SECURITY DEFINER would run as the function owner and BYPASS RLS —
-- an admin dashboard would then return every tenant's rows. This is
-- deliberately invoker-scoped so the existing policies from migrations
-- 008/012 still filter every row. The grants below are only EXECUTE.
--
-- WHY THE DAY BOUNDARIES ARE PARAMETERS AND NOT now() IN SQL
-- The original code computed "today" in JavaScript on the server. Doing
-- it in SQL would silently change which tasks count as due today for
-- any deployment whose timezone differs from IST. Passing the same two
-- timestamps the old code computed preserves behaviour exactly, so this
-- migration is a pure transport change with no semantic difference.
--
-- Idempotent. Run AFTER 021_push_and_calendar_cleanup.sql.
--
-- DOWN MIGRATION
--   DROP FUNCTION IF EXISTS public.get_admin_dashboard(TIMESTAMPTZ, TIMESTAMPTZ);
--   The application falls back to the nine-query path automatically when
--   this function is absent (see lib/actions/dashboard.ts), so reverting
--   is safe at any time.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_admin_dashboard(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER          -- RLS applies. Do not change to DEFINER.
SET search_path = public
STABLE
AS $$
DECLARE
  v_due_today       bigint;
  v_needs_review    bigint;
  v_overdue         bigint;
  v_pending_pay     numeric;
  v_pending_appr    bigint;
  v_needs_attention jsonb;
  v_needs_attention_overdue jsonb;
  v_todays_work     jsonb;
  v_recent_activity jsonb;
BEGIN
  -- Each of these was a separate round-trip before. Same predicates, so
  -- the numbers cannot drift from the old implementation.
  SELECT count(*) INTO v_due_today
    FROM tasks
   WHERE deadline >= p_start
     AND deadline <= p_end
     AND status <> 'COMPLETED';

  SELECT count(*) INTO v_needs_review
    FROM tasks
   WHERE status = 'SUBMITTED';

  SELECT count(*) INTO v_overdue
    FROM tasks
   WHERE deadline < p_start
     AND status <> 'COMPLETED';

  -- Summed in the database now. The old path shipped every unpaid row to
  -- the server purely to add it up.
  SELECT COALESCE(sum(amount), 0) INTO v_pending_pay
    FROM payments
   WHERE paid_at IS NULL;

  SELECT count(*) INTO v_pending_appr
    FROM profiles
   WHERE role = 'EMPLOYEE'
     AND status = 'PENDING';

  -- Submitted tasks awaiting review.
  --
  -- Every key is listed explicitly. An earlier version used
  -- `to_jsonb(s) || jsonb_build_object(...)`, which emitted the CTE's
  -- column names (id/title/updated_at/full_name) and left out `kind`,
  -- `created_at` and `deadline` entirely — so the dashboard rendered
  -- rows whose kind was undefined and showed no timestamp at all.
  WITH submitted AS (
    SELECT t.id, t.title, t.updated_at, t.deadline, p.full_name
      FROM tasks t
      LEFT JOIN profiles p ON p.id = t.assigned_to
     WHERE t.status = 'SUBMITTED'
     ORDER BY t.updated_at DESC
     LIMIT 6
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'kind', 'SUBMITTED',
           'title', coalesce(s.full_name, 'Someone') || ' submitted',
           'subtitle', s.title,
           'actor_name', s.full_name,
           'created_at', s.updated_at,
           'deadline', NULL
         ) ORDER BY s.updated_at DESC), '[]'::jsonb)
    INTO v_needs_attention
    FROM submitted s;

  -- Overdue tasks, folded into the same attention list.
  WITH overdue AS (
    SELECT t.id, t.title, t.deadline, p.full_name
      FROM tasks t
      LEFT JOIN profiles p ON p.id = t.assigned_to
     WHERE t.deadline < p_start
       AND t.status <> 'COMPLETED'
     ORDER BY t.deadline ASC
     LIMIT 4
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'kind', 'OVERDUE',
           'title', coalesce(o.full_name, 'Unassigned') || '''s task is overdue',
           'subtitle', o.title,
           'actor_name', o.full_name,
           'created_at', NULL,
           'deadline', o.deadline
         ) ORDER BY o.deadline ASC), '[]'::jsonb)
    INTO v_needs_attention_overdue
    FROM overdue o;

  v_needs_attention := coalesce(v_needs_attention, '[]'::jsonb)
                        || coalesce(v_needs_attention_overdue, '[]'::jsonb);

  -- Today's work: due today or overdue, not completed.
  WITH todays AS (
    SELECT t.id, t.title, t.status, t.deadline, t.priority,
           p.full_name AS assigned_name,
           pr.name     AS project_name
      FROM tasks t
      LEFT JOIN profiles p  ON p.id  = t.assigned_to
      LEFT JOIN projects pr ON pr.id = t.project_id
     WHERE t.status <> 'COMPLETED'
       AND (t.deadline <= p_end OR t.deadline >= p_start)
     ORDER BY t.deadline ASC NULLS LAST
     LIMIT 8
  )
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_todays_work
    FROM todays t;

  -- Recent activity: comments, newest first.
  WITH activity AS (
    SELECT c.id, c.comment, c.created_at,
           u.full_name,
           t.title AS task_title
      FROM task_comments c
      LEFT JOIN profiles u ON u.id = c.user_id
      LEFT JOIN tasks t    ON t.id = c.task_id
     ORDER BY c.created_at DESC
     LIMIT 6
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', 'comment-' || a.id,
           'kind', 'comment',
           'title', coalesce(a.full_name, 'Someone') || ' commented',
           'detail', CASE
                        WHEN a.task_title IS NOT NULL
                          THEN a.task_title || ' — ' || left(a.comment, 60)
                        ELSE left(a.comment, 60)
                      END,
           'created_at', a.created_at
         ) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_recent_activity
    FROM activity a;

  RETURN jsonb_build_object(
    'counts', jsonb_build_object(
      'due_today',        COALESCE(v_due_today, 0),
      'needs_review',     COALESCE(v_needs_review, 0),
      'overdue',          COALESCE(v_overdue, 0),
      'pending_payments', COALESCE(v_pending_pay, 0),
      'pending_approvals',COALESCE(v_pending_appr, 0)
    ),
    'needs_attention', v_needs_attention,
    'todays_work',     v_todays_work,
    'recent_activity', v_recent_activity
  );
END;
$$;

-- Only authenticated users may call it, and only EXECUTE: the function
-- reads tables through the caller's RLS, so it needs no table grants.
REVOKE ALL ON FUNCTION public.get_admin_dashboard(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;