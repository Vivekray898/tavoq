# Phase 3 — Google Calendar QA checklist

Automated coverage: `tests/google-calendar-phase3.test.ts` (34 tests).

---

## 0. Diagnosis: what was actually broken

Much of the integration already existed and is sound: a dedicated OAuth flow
with `access_type=offline`, `prompt=consent` and `include_granted_scopes`;
cookie-bound `state` with a 10-minute TTL for CSRF; AES-256-GCM encryption
with a rotation-friendly `v1:` prefix; refresh-token rotation handling; and the
retired `userinfo` endpoint already replaced.

The real defects:

| Area | Finding |
|------|---------|
| OAuth flow | **Already correct.** Not the problem. |
| Missing refresh token | `prompt=consent` already forced. Not the problem. |
| Wrong scopes | `calendar.events` already minimal. Not the problem. |
| Redirect URI mismatch | Normalised; no double slash. Not the problem. |
| **Timezone** | **Real bug.** See §1. |
| Connection state | **No `status`.** A revoked grant deleted its own evidence. |
| Mapping | Lived on `tasks.google_event_id`, which cannot hold sync state. |
| Retry | None anywhere in the file. |

### The one thing that needs you

**Is the OAuth app published or still in "Testing" mode?**

Google Cloud Console → **APIs & Services → OAuth consent screen**. If the
screen shows the app is **unverified / in Testing**, refresh tokens expire
after **7 days**. That single fact outweighs every item above — users would
reconnect weekly and blame the app. If you see *Publishing status: In
production*, this is not your problem.

---

## 1. The timezone bug (most important)

`tasks.deadline` is a `TIMESTAMPTZ`, but `buildEventBody` sliced
`deadline.toISOString().slice(0, 10)` to get the all-day date. IST is
UTC+5:30, so any deadline **before 05:30 IST** converts to the *previous* UTC
day and the event landed a day early.

Verified: `2026-03-10T02:00+05:30` is `2026-03-10` in Kolkata but
`2026-03-09` via the ISO slice.

| # | Check | Expected |
|---|-------|----------|
| 1.1 | Create a task due `2026-03-10T02:00` IST, sync | Google event on **10 March**, not the 9th |
| 1.2 | Inspect the event | `timeZone: Asia/Kolkata` |
| 1.3 | Task with no deadline | Timed event in **IST**, not UTC |
| 1.4 | Event spans | `start.date` = due day, `end.date` = **next** day (exclusive) |
| 1.5 | Deadline on 31 Jan / 31 Dec | Correct day, no overflow |

---

## 2. Migration 024

**Supabase click-path:** Dashboard → project → **SQL Editor** → New query →
paste `supabase/migrations/024_google_connections_and_calendar_events.sql` →
**Run**. Then **Table Editor** → confirm `google_connections` and
`calendar_events` exist.

| # | Check | Expected |
|---|-------|----------|
| 2.1 | Existing connections survive | `SELECT count(*) FROM google_connections;` matches `user_google_tokens` |
| 2.2 | Status | `'ACTIVE'` for backfilled rows |
| 2.3 | Existing task mappings carried over | `calendar_events` populated from `tasks.google_event_id` |
| 2.4 | `user_google_tokens` still present | Yes — nothing dropped |
| 2.5 | Token stored encrypted | `encrypted_refresh_token` starts with `v1:`, never a raw token |

---

## 3. Connection state

The key improvement: a revoked grant no longer **deletes** the row.

| # | Check | Expected |
|---|-------|----------|
| 3.1 | Connect | `status = 'ACTIVE'`, `connected_at` set |
| 3.2 | Revoke access at Google Account → Security → Third-party access | |
| 3.3 | Trigger a sync | `status` flips to `'NEEDS_RECONNECT'`, `last_error` = `invalid_grant` |
| 3.4 | Settings UI | Says access expired and **offers Reconnect** — not "not connected" |
| 3.5 | The row still exists | Yes — the evidence survives |
| 3.6 | Explicit **Disconnect** | Row deleted (a deliberate opt-out is different) |

Before Phase 3, step 3.3 deleted the row and 3.4 could only ever say "not
connected", sending the user through consent for a problem they did not cause.

---

## 4. Sync

| # | Check | Expected |
|---|-------|----------|
| 4.1 | Sync one task | Event created, `calendar_events` row written |
| 4.2 | Sync the same task again | **Updated in place**, no duplicate event |
| 4.3 | Change the date, re-sync | Same event id, new date |
| 4.4 | Reassign the task | Mapping follows the new assignee |
| 4.5 | Complete the task | Event removed, mapping cleared |
| 4.6 | Delete the event in Google, re-sync | Recreated cleanly |
| 4.7 | Event carries `taskoraTaskId` | Extended property present — this is what makes it idempotent |

Uniqueness on `(user_id, task_id)` and `(user_id, google_event_id)` is what
enforces idempotency at the data layer.

---

## 5. Retry

| # | Check | Expected |
|---|-------|----------|
| 5.1 | 429 / 5xx from Google | Retried with exponential backoff, capped at 8s |
| 5.2 | 400 / 401 / 403 / 404 | **Not** retried — fails identically forever |
| 5.3 | `invalid_grant` | Never retried; marks `NEEDS_RECONNECT` |

Retrying a permanent 4xx hides the real problem behind a spinner.

---

## 6. Two-way sync (optional step)

Already present via the watch-channel webhook; Phase 3 did not change it.

| # | Check | Expected |
|---|-------|----------|
| 6.1 | `/api/calendar/webhook` receives a change | Incremental sync runs using `sync_token` |
| 6.2 | Channel expiry (~7 days) | Renewed before lapsing |

---

## Limitations

- **No live Google API test.** Everything here is verified by unit tests and
  manual QA against a real account. The OAuth round-trip, token refresh and
  event writes cannot be exercised without a configured Google Cloud project.
- `toZonedDateTime` hardcodes the **+05:30** offset. That is exact for Kolkata,
  which has had no DST since 1945 — but a per-user timezone setting would need
  a real offset lookup.
- Migrations 023 and 024 are **not applied** to your database. No psql or
  Supabase CLI is available here.

## Manual dashboard settings

**Google Cloud Console → APIs & Services → OAuth consent screen:**
1. Check **Publishing status** (the 7-day refresh token question).
2. If *In production*: **Publish app**.
3. **Credentials** → your OAuth 2.0 Client ID → **Authorized redirect URIs**
   must contain exactly `{YOUR_APP_URL}/api/auth/google/callback` — no
   trailing slash. A mismatch presents as a generic "Couldn't connect".
4. Confirm the `calendar.events` scope appears under **Data Access**.

**Vercel:** no new variables. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WEBHOOK_*` are already configured.

> Do **not** rotate `GOOGLE_TOKEN_ENCRYPTION_KEY` without a re-encryption
> migration — existing ciphertext would fail to decrypt.
