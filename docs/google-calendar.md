# Google Calendar sync

Setup instructions for the Google Cloud project are in
[`google-calendar-setup.md`](./google-calendar-setup.md). This document
covers **how ownership works and why events don't duplicate.**

## Why no duplicates

**An event belongs to the person the task is assigned to. Nobody else.**

Every push path filters on `assigned_to`:

- `syncTaskToCalendar(taskId)` loads the task with
  `.eq("assigned_to", profile.id)`. If the caller is not the assignee,
  the task is simply not found and nothing is written.
- `fullSyncForUser(userId)` / `syncAllTasksToCalendar()` load
  `.eq("assigned_to", userId)` for the calling user.
- `incrementalSyncForUser(userId)` re-syncs that same set.

So a super admin who connects their Google account receives events only
for tasks assigned **to them**. The same is true for managers and
employees. There is no admin-wide fan-out and no service account, which
means the number of connected accounts cannot multiply events: three
connected admins still produce exactly one event per task, held by
whichever of them owns the task.

If you call a sync for a task you don't own, it returns
`{ success: true, data: { skipped: true } }` — not an error. Skipping is
the correct outcome, not a failure.

## Reassignment

`tasks.google_event_id` is a **single column**, but the calendar it
points at belongs to one account. So when a task moves from A to B:

1. A `BEFORE UPDATE` trigger (`clear_google_event_on_reassign`,
   migration `016`) sets `google_event_id = NULL` whenever
   `assigned_to` changes.
2. B's next sync sees a null id and **creates** a fresh event in B's
   calendar.

### Why clear rather than track an owner column

The alternative was a second column, `tasks.google_event_owner UUID`,
which would let the app delete the departing owner's event directly.
We chose clearing instead:

- **One source of truth.** An owner column can disagree with the token
  table (someone disconnects, or a token is revoked) and then two
  sources both claim authority over the same event.
- **Self-correcting.** A cleared id means "nobody has an event for this
  task yet", which is always true. The next sync rebuilds it for whoever
  owns the task *now*.
- **Cheaper.** No extra column, no join, no second write path.

The trade-off: the previous owner's event stays in their calendar until
they notice or delete it. That is one stale entry in one person's
calendar, instead of a duplicated or orphaned event in every connected
admin's calendar. We think that is the better failure mode — and note
that with assignee-only ownership, the old event is the *only* stray, so
there is nothing to clean up anywhere else.

## Completion

A task that reaches `COMPLETED` has its event **deleted**, not annotated.
`fullSyncForUser()` clears `google_event_id` and skips completed tasks.
A finished task should not occupy time on anyone's calendar.

## One-time cleanup

Migration `016` also clears any pre-existing `google_event_id` whose
assignee does not hold a connected calendar. Those ids are stale by
definition — they cannot be pushed or verified — and leaving them set
would make a later connection believe the event already existed.

## Manual reconciliation

No outbound cron exists by design. Pushes happen from action hooks
(create, reassign, edit, status change), and the daily cron handles
inbound calendar changes. To force a rebuild after changing connections,
disconnect and reconnect Google Calendar, which clears the sync cursor
and triggers a full re-sync.

## Disconnect and reconnect

Disconnecting deletes the `user_google_tokens` row, so the next sync finds no
token and returns `Connect Google Calendar first` rather than failing. It also
clears the sync cursor, so reconnecting triggers a **full re-sync** rather than
an incremental one.

Full sync is idempotent: each task has at most one `google_event_id`, and a
task with one is updated in place (`PUT`) rather than created again
(`POST`). So disconnect/reconnect does not produce duplicates.

Migration 016 additionally clears any `google_event_id` whose assignee holds
no connected calendar, so a stale id cannot make a fresh connection believe
the event already exists.

## When Google revokes the grant

A user can revoke Taskora's access from their Google account at any time. The
next call then fails with `401 invalid_grant`.

**What happens today:** `fullSyncForUser()` catches the failure per task and
pushes the message into `SyncResult.errors`, then continues with the rest of
the batch — one revoked grant never aborts the whole sync. But
`components/settings/google-calendar-connect.tsx` only reads `created`,
`updated` and `removed` from the result, so a sync where every task failed
still reports "0 added, 0 updated" as a success. **The user is not told their
grant was revoked.**

The practical fix is to reconnect from **Profile → Google Calendar**. Until
the UI surfaces `SyncResult.errors`, a repeatedly-empty sync on a previously
working account is the symptom to watch for.

Surfacing `errors.length` in the toast would be the fix; it is not done, so
it is recorded here rather than claimed as behavior.

## Rotating `GOOGLE_TOKEN_ENCRYPTION_KEY`

Refresh tokens are encrypted at rest with AES-256-GCM using this key
(`lib/crypto/google-token.ts`, `v1:<iv>:<tag>:<ciphertext>`).

**Rotating it makes every stored token undecryptable. All users must
disconnect and reconnect Google Calendar.** There is no re-encryption path,
because the old key is what encrypted them.

Rotate only if the key leaks, and warn users before you do. Clearing
`user_google_tokens` gives everyone a clean reconnect prompt rather than a
silent failure on first sync:

```sql
DELETE FROM user_google_tokens;
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| No events appear | The user has not connected, or the cursor is stale — try a full sync |
| Duplicate events | Stale ids from before migration 016. Run `supabase db push`, then disconnect/reconnect to force a full re-sync |
| Event in the wrong calendar | The task was reassigned and the previous owner's event remains. The new owner gets theirs on their next sync |
| "Connect Google Calendar first" | No `user_google_tokens` row for that user |
| 401 / `invalid_grant` | The grant was revoked on Google's side — have the user reconnect. Not surfaced in the UI today; see above |
| One bad task blocks the sync | It shouldn't: per-task errors are collected into `SyncResult.errors` |
| Sync reports "0 added, 0 updated" but tasks are missing | Check `SyncResult.errors` — the failures are being swallowed |