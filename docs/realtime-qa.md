# Realtime QA checklist

Every change any user makes must reach every other open session within
about a second, with no manual refresh. There is deliberately **no
polling** and **no `router.refresh()`** — if a screen only updates after
you reload it, something is wrong with its subscription or its query key.

## What is subscribed

`components/providers/realtime-provider.tsx` holds one channel for the
session. Migration `015_realtime_publication.sql` guarantees each of
these tables is in the `supabase_realtime` publication — a table that
is not published never fires, with no error anywhere.

| Table | Patched cache | Method |
| --- | --- | --- |
| `tasks` | `qk.tasks()`, `qk.taskDetail(id)` | UPDATE/DELETE patched in place; INSERT refetches the active list (realtime rows carry no embedded project/labels) |
| `task_comments` | `qk.taskDetail(id)` | appended, sorted by `created_at`, author resolved |
| `payments` | `qk.paymentWorkspace()`, `["payments"]` | refetch when active (aggregates are not patchable) |
| `notifications` | `qk.notifications()` | prepended, capped at 100; badge derives from these rows |
| `profiles` | `qk.employeesList()`, `qk.activeEmployees()` | patched in place so approvals flip live |
| `project_members` | projects list, `qk.projectsForTask()` | refetch only the active query |
| `project_resources` | `qk.projectDetail(id)` | patched in place |
| `task_subtasks` | `qk.taskDetail(id)` | patched in place, `subtasks_done` recomputed |
| `activity` | `qk.taskActivity()`, `qk.projectActivity()` | prepended into caches matching the row's scope |
| `projects` | project detail + list | detail patched, list refetched (archive flips tabs) |
| `clients` | client detail + list | detail patched, list refetched |

## Manual QA — two browsers, two users

Sign in as two different users in two separate browser profiles (not two
tabs — some browsers share a session). Keep both on the same screen where
the test calls for it.

| # | Action in A | Expect in B (no refresh) |
| --- | --- | --- |
| 1 | Create a task | Appears in the right board column |
| 2 | Drag a card to another column | Same column in B |
| 3 | Post a comment on a task | Comment appears in B's task detail |
| 4 | Mark a payment paid | Row flips to Paid |
| 5 | Approve an employee | Status badge updates in the employees list |
| 6 | Trigger a notification for B | Badge count increments |
| 7 | Assign a task to someone | Assignee and status update |
| 8 | Add/remove a project member | Project list updates |

### Timing

Every row above should land in **under ~1s**. If it takes noticeably
longer, check that the table is in the `supabase_realtime` publication.

## Offline and reconnect

1. Put browser B offline.
2. Make changes in A.
3. Bring B back online.

B should catch up. Realtime is a live socket, not a durable queue, so
events sent while B was disconnected are **not** guaranteed to be
replayed. On reconnect the provider invalidates only the **active**
queries — never a full page reload — so B catches up on what it is
currently looking at. If a background screen has stale data, simply
navigating to it renders fresh from the (already stale-marked) cache.

## Common failures

| Symptom | Cause |
| --- | --- |
| Nothing updates anywhere | Table missing from `supabase_realtime` — check migration 015 applied |
| One screen stale, others fine | That query's key is not reachable from the handler; add the key to `qk` and patch it |
| Updates land but the UI doesn't move | The patch targets a different key than the component reads — compare `qk.*` usage |
| Updates only after a reload | A refetch is happening but the cache isn't being written, or the component holds local state that ignores the cache |
| Duplicate rows after an event | The handler prepends without an id check — verify the `some(...)` guard is present |

## What Phase 3 verified, and what it did not

**Verified by execution** (`pnpm test`):

- Exactly one channel per session, torn down on unmount — asserted by
  counting `.channel(` calls in `tests/e2e/hardening.test.ts`. A deliberate
  duplicate was injected to confirm the check fails.
- Every reconnect/realtime invalidation is scoped to active queries; no bare
  `invalidateQueries()` that would refetch the whole app.
- `refetchOnWindowFocus: false` and `refetchOnReconnect: true` on the query
  client; no `refetchInterval` anywhere.
- Every table the provider subscribes to is named in migration 015 — checked
  in **both** directions, so neither a missing subscription nor a stray
  publication can slip through.
- Optimistic writes snapshot the cache, and every rollback is followed by a
  `toast.error` within three lines (per-site, not per-file).

**Not verified by execution — do the manual pass:**

- Actual cross-browser delivery within ~1s.
- Offline/reconnect catch-up.
- Notification badge increments.

These need two signed-in browser contexts and a real network drop. The
automated suite deliberately makes no writes to the live database to
simulate them — an earlier draft inserted probe rows into the project and
was rewritten as read-only, because writing to a real database to satisfy a
test is a side effect nobody asked for.

## Caveats discovered in Phase 3

- **A table missing from `pg_publication_tables` fails silently.** No error
  reaches the application; the subscription simply never fires. If one screen
  is stale and the others are fine, check the publication first — see the
  runbook.
- **`setQueriesData` does not pass the query to its updater.** Patching several
  differently-scoped caches with one updater (activity feeds key their limit
  inside the query key) needs `getQueriesData` plus a per-key write. Getting
  this wrong patches the wrong cache silently.
- **Realtime payloads carry no embedded data.** A `tasks` INSERT cannot patch
  a list item, because `project_name` and labels are not in the payload; that
  one case refetches the active list. Updates and deletes patch fine.

## Adding a table

1. Add it to `REALTIME_TABLES` in `lib/queries/keys.ts` (this documents
   which cache each event writes).
2. Add it to the list in `015_realtime_publication.sql` and re-run
   `supabase db push`.
3. Register a handler in the realtime provider that **patches** the
   cache. Refetching is a last resort, and only for aggregates that
   cannot be patched — say why in a comment.