#!/usr/bin/env bash
#
# Phase H — index verification.
#
# Every index this project adds must be justified by a query plan, not by
# intuition. This runs EXPLAIN (ANALYZE, BUFFERS) as the AUTHENTICATED
# role so RLS policies are included in the plan — an EXPLAIN run as
# postgres or service_role silently bypasses them and will happily show a
# seq scan that a real user never experiences.
#
# Requires:
#   DATABASE_URL      — a role-scoped connection string (NOT service_role)
#   TSOBA/TASKORA_USER — an authenticated user id, so RLS has a subject
#
# Usage:
#   scripts/explain.sh              # run every query
#   scripts/explain.sh delta        # run one
#
# There is deliberately no fallback that runs without a database: a
# missing psql must produce an error, never a fake plan.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set." >&2
  echo "Run as a role-scoped connection string; service_role bypasses RLS" >&2
  echo "and will produce a plan that does not reflect real usage." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install the postgres client." >&2
  exit 2
fi

SUBJECT="${TASKORA_USER:-00000000-0000-0000-0000-000000000000}"

run_explain() {
  local name="$1"
  local sql="$2"
  echo ""
  echo "── ${name} ─────────────────────────────────────────"
  # request.jwt.claims is what the RLS helpers read (auth.uid(), auth.role()).
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -c "BEGIN; SET LOCAL request.jwt.claims = '{\"sub\":\"${SUBJECT}\",\"role\":\"authenticated\"}'; ${sql}; COMMIT;" \
 2>/dev/null || psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -c "BEGIN; SET LOCAL request.jwt.claims = '{\"sub\":\"${SUBJECT}\",\"role\":\"authenticated\"}'; ${sql}; COMMIT;"
}

case "${1:-all}" in
  dashboard)
    # The 9-query dashboard read Phase B collapses into one RPC.
    run_explain "admin dashboard — tasks by status" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT id, title, status, due_date, assigned_to FROM tasks WHERE status <> 'COMPLETED' ORDER BY due_date NULLS LAST LIMIT 50;"
    run_explain "admin dashboard — unassigned count" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM tasks WHERE assigned_to IS NULL AND status <> 'COMPLETED';"
    ;;
  delta)
    # Phase D. Requires idx_tasks_updated_at (exists since 002).
    run_explain "delta — tasks since cursor" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT id, updated_at FROM tasks WHERE updated_at > now() - interval '1 day' ORDER BY updated_at LIMIT 200;"
    run_explain "delta — notifications since cursor" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM notifications WHERE created_at > now() - interval '1 day' ORDER BY created_at LIMIT 200;"
    ;;
  unread)
    # Notification badge — drives the unread count on every page.
    run_explain "unread count" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM notifications WHERE user_id = '${SUBJECT}' AND read = false;"
    ;;
  *)
    run_explain "admin dashboard — tasks by status" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT id, title, status, due_date, assigned_to FROM tasks WHERE status <> 'COMPLETED' ORDER BY due_date NULLS LAST LIMIT 50;"
    run_explain "delta — tasks since cursor" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT id, updated_at FROM tasks WHERE updated_at > now() - interval '1 day' ORDER BY updated_at LIMIT 200;"
    run_explain "unread count" \
      "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM notifications WHERE user_id = '${SUBJECT}' AND read = false;"
    ;;
esac