# Phase 2 — Web Push QA checklist

Covers notification delivery, per-user preferences, the dedupe log, and the
client permission states.

Automated coverage: `tests/push-delivery.test.ts` (38 tests).

---

## 0. Diagnosis: what was actually wrong

Push was **not** broken end to end. VAPID keys were present in `.env.local`,
`lib/push.ts` fanned out with `Promise.allSettled` and pruned dead endpoints,
and the subscribe/unsubscribe routes already authenticated through
`createClient().auth.getUser()`. Five of the six required triggers already
routed through `createNotification`.

The real defects were:

| Area | Finding |
|------|---------|
| VAPID env | Present. Not the problem. |
| SW registration | Worked, but **moved in Phase 1** from `/sw.js` to `/serwist/sw.js`. See the caveat at the bottom. |
| Permission flow | Five states. Could not express **iOS not installed** or **Chrome on iOS**, so those users got a button that did nothing. |
| Subscription storage | No `last_success_at`, so a silently-dead device was indistinguishable from a healthy one. |
| Per-user preferences | **Did not exist at all** — required new schema, not a code change. |
| Dedupe | Only the 5am cron had it (`daily_reminder_log`). Push-driven triggers had none. |
| Triggers | **"Status changed" produced no notification at all**, so no push. Five others were fine. |
| HTTPS | Vercel provides it; `localhost` is exempt. Not the problem. |

---

## 1. Migration

```bash
# Apply supabase/migrations/023_push_delivery_and_preferences.sql
```

**Supabase click-path:** Dashboard → your project → **SQL Editor** → New query
→ paste the migration → **Run**. Then **Table Editor** → confirm
`notification_preferences` and `push_delivery_log` exist, and that
`push_subscriptions` gained `last_success_at`.

> `notification_type` gains `TASK_STATUS_CHANGED`. This migration only *adds*
> the value and never uses it in SQL — using an enum value in the same
> migration that adds it is Postgres error `55P04`. `pnpm test` enforces this
> via `scripts/verify-migration-enum-order.mjs`.

**Backfill is not required.** Preferences default to ON, so no existing user
loses notifications. Verify: `SELECT count(*) FROM notification_preferences;`
should be 0 immediately after the migration.

---

## 2. Enable notifications

| # | Check | Expected |
|---|-------|----------|
| 2.1 | Signed in as any role → `/notifications` | Permission card at the top |
| 2.2 | Click **Enable notifications** | Browser prompt appears |
| 2.3 | Allow | "Notifications enabled" toast; card switches to "Notifications are on" |
| 2.4 | Reload the page | State persists as subscribed |
| 2.5 | Click **Turn off** | Returns to the pre-enable state, toast confirms |
| 2.6 | `SELECT * FROM push_subscriptions` | One row, `last_success_at` still NULL until a push lands |

Never prompts on page load — permission is always user-initiated.

---

## 3. Send test notification

| # | Check | Expected |
|---|-------|----------|
| 3.1 | Subscribed → click **Send test** | "Sent to 1 device." |
| 3.2 | A system notification appears | "Taskora — Test notification…" |
| 3.3 | Click it | App focuses on `/notifications` |
| 3.4 | Click **Send test** with no subscribed devices | Clear error, not a fake success |
| 3.5 | Re-enable on a second device, click **Send test** | "Sent to 2 devices." — proves fan-out |

The button reports the real device count and says so when nothing is
reachable. It deliberately **ignores preferences and dedupe**: the point is
to prove the device works.

---

## 4. Per-user preferences

| # | Check | Expected |
|---|-------|----------|
| 4.1 | Preferences card visible on `/notifications` | Yes — for **every** role |
| 4.2 | Turn off **Comments** → have someone comment | No push for that comment |
| 4.3 | Turn **Push notifications** (master) off | All channel switches disable |
| 4.4 | Reload | Choices persisted |
| 4.5 | Inspect the row | Only whitelisted boolean columns written; `user_id` = your own |
| 4.6 | As a different user | Your settings are not visible or editable |

**Placement note:** this is on `/notifications`, not `/settings`. That route is
SUPER_ADMIN-only, so a per-user control there would be invisible to exactly the
employees who need it.

---

## 5. Triggers

Confirm each produces **both** an in-app notification and a push:

| # | Event | Recipient |
|---|-------|-----------|
| 5.1 | Task assigned | assignee |
| 5.2 | Task reassigned | new assignee |
| 5.3 | Status changed (TODO → IN_PROGRESS) | assignee |
| 5.4 | Revision requested | assignee |
| 5.5 | Comment added | followers |
| 5.6 | Payment marked paid | employee |
| 5.7 | Due-today reminder (05:00 cron) | assignee |

**5.3 is new in Phase 2.** Status changes previously produced nothing at all.
It deliberately excludes SUBMITTED / COMPLETED / REVISION_REQUIRED, which have
their own richer notifications — one change must not notify twice.

---

## 6. Dedupe

| # | Check | Expected |
|---|-------|----------|
| 6.1 | Trigger a notification | `push_delivery_log` gains a row |
| 6.2 | Re-fire the same action | **No** second push |
| 6.3 | Inspect `dedupe_key` | `{user}:{TYPE}:{notification_id}` |
| 6.4 | Trigger a *different* comment on the same task | **Both** delivered (different row ids) |
| 6.5 | A second user, same task | Never shares a key |

`daily_reminder_log` still dedupes the cron; this covers the interactive
triggers. Deleting the log row and re-firing re-sends — useful for testing.

---

## 7. iOS

| # | Check | Expected |
|---|-------|----------|
| 7.1 | iOS Safari, in a browser tab | "Add Taskora to your Home Screen first" |
| 7.2 | Chrome or Firefox **on iOS** | "Not supported in this browser" — explains Safari-only |
| 7.3 | Add to Home Screen, reopen | Enable button becomes available |
| 7.4 | Enable on iOS 16.4+ | Works |
| 7.5 | iOS below 16.4 | Fails loudly, not silently |

These three states previously all rendered as either "unsupported" or a dead
button.

---

## 8. Device health

| # | Check | Expected |
|---|-------|----------|
| 8.1 | Successful push | `last_success_at` set on that row |
| 8.2 | Push service returns 404/410 | Row deleted; other devices unaffected |
| 8.3 | A device never succeeds | `last_success_at` stays NULL — detectable as unhealthy |

---

## 9. Secrets

| # | Check | Expected |
|---|-------|----------|
| 9.1 | `grep -r VAPID_PRIVATE_KEY lib components app` | Only `lib/push.ts` (server-only) |
| 9.2 | Inspect the client bundle | No private key, no service-role key |
| 9.3 | `lib/push.ts` first line | `import "server-only";` |
| 9.4 | `sendTestPush()` takes no userId | Callers cannot target another user |

---

## Limitations

- **No browser-level push harness.** Playwright cannot grant real push
  permission or receive a real push, so steps 2–8 are manual by necessity. The
  delivery logic is covered by unit tests; actual delivery needs a human.
- `sendTestPush` reports success based on the push service accepting the
  payload, not on the OS displaying it.
- Requires real VAPID keys on the deployed environment; absent keys make
  `sendTestPush` report "Push isn't configured on this server."

## Known caveat: subscriptions invalidated by Phase 1

Phase 1 moved the worker from `/sw.js` to `/serwist/sw.js`. A push
subscription's endpoint is bound to the script URL that created it, so
subscriptions created before that deploy fail and are pruned on 404/410.

Affected users see the **"Notifications allowed, but not set up"** state, which
offers a one-click **Enable notifications** to re-establish them. That state is
new in Phase 2 specifically to repair this. Expect a temporary drop in push
delivery until users re-subscribe.

## Dashboard settings required

**None beyond applying the migration.** VAPID keys already exist. No Supabase,
Vercel, or Google Cloud changes are needed for Phase 2.

**Manual VAPID regeneration** (only if keys are ever rotated):
1. `npx web-push generate-vapid-keys`
2. Vercel → your project → **Settings → Environment Variables**: update
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` → Save
   → redeploy. **Note:** rotating the key invalidates every existing
   subscription; all users must re-subscribe.