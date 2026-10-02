# Changelog

## Phase 3 — end-to-end tests, hardening, and docs

Integration tests against the live database for role authorization,
refused-escalation auditing, cron contracts and calendar ownership; a
hardening suite for realtime resilience, optimistic-update rollback and
action error surfaces. Found and fixed one real bug: **refused privilege
escalations were never audited.** The audit `INSERT` sat inside a
`BEGIN…EXCEPTION` block that the following `RAISE` rolled back, and RLS
refused the insert from the very manager whose attempt we wanted to record
— so the audit could not persist by construction (migration 017).
Documentation brought in line with the shipped code, including an operator
runbook.

## Phase 2 — role-aware UI, realtime parity, calendar ownership

Managers can now use the app Phase 1 authorized them for: the sidebar
shows Team, Clients, Projects and Payments but not Settings, and the pages
that hard-gated on `SUPER_ADMIN` now admit staff. Realtime gained the four
tables that were described as subscribed but were not (`activity`,
`project_resources`, `task_subtasks`, `project_members`), plus surgical
cache patching for profiles so approvals flip live. Optimistic updates
with snapshot-rollback landed for payments and employee approval.

Calendar: the described admin fan-out did not exist — both sync paths
already filtered on `assigned_to`. The real defect was that
`google_event_id` survived reassignment, so a new assignee would `PUT` an
event id belonging to someone else's calendar (migration 016).

Also fixed a Phase 1 regression: `tasks.ts` and `comments.ts` still
filtered `role = 'ADMIN'`, a value migration 013 removed. As a query
string it passed `tsc`, and would have thrown the moment a submission or
comment notification ran. A static test now guards it.

## Phase 1 — role hierarchy at the data and action layer

Three roles — `SUPER_ADMIN`, `MANAGER`, `EMPLOYEE` — replacing the old
`ADMIN`/`EMPLOYEE` pair. Migration 013 renames the enum value in place
(preserving all four dependent columns and the lifecycle RPC signature)
and adds `MANAGER`; migration 014 adds the authorization helpers, rewrites
the RLS policies, and reworks `manage_profile_lifecycle()` so a manager can
never act on a peer or mint a privileged role. The split exists because
Postgres refuses to use a new enum value in the transaction that created it
(`ERROR 55P04`) — which is exactly how the first attempt failed.