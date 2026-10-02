# Operator runbook

One page. Everything here is SQL in the Supabase **SQL Editor** unless noted.

## Promote the first Super Admin

There is no UI for this by design — the first super admin must be created
deliberately, never by login order.

```sql
UPDATE profiles
SET role = 'SUPER_ADMIN', status = 'ACTIVE', active = true, approved_at = now()
WHERE email = 'you@youragency.com';
```

The user must then sign out and back in for the session to pick up the role.
(After a promotion by *another* user, realtime patches it live — no re-login.)

**Never leave exactly zero active super admins.** The
`manage_profile_lifecycle` RPC refuses to demote or suspend the last one, but
if you edit `profiles` directly that guard does not apply.

## Demote, suspend, reactivate

Prefer the UI (Team page) — it enforces the manager scope rules and writes an
audit row. From SQL when you have to:

```sql
-- Suspend (blocks access immediately)
UPDATE profiles SET status = 'SUSPENDED', active = false
WHERE email = 'someone@youragency.com';

-- Reactivate
UPDATE profiles SET status = 'ACTIVE', active = true
WHERE email = 'someone@youragency.com';

-- Demote to employee
UPDATE profiles SET role = 'EMPLOYEE' WHERE email = 'someone@youragency.com';

-- Promote to manager
UPDATE profiles SET role = 'MANAGER' WHERE email = 'someone@youragency.com';
```

Direct SQL writes are **not** audited and bypass the last-super-admin guard.
Prefer the UI unless you are recovering from a lockout.

## Run the cron manually

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/daily-reminders
```

Expect `200` with `{"ok":true,...}`. Without the header: `401`. A `307` to
`/login` means the proxy is gating `/api/cron` again — `/api/cron` must be in
`PUBLIC_PREFIXES` in `proxy.ts`.

Running it twice is safe: `daily_reminder_log` has a
`UNIQUE (user_id, task_id, reminder_date)` constraint, so the second run
reports `notified: 0`.

## Check the audit log

```sql
SELECT created_at, action, actor_id, target_profile_id,
       previous_role, next_role, detail
FROM admin_audit_log
ORDER BY created_at DESC
LIMIT 50;
```

Every profile lifecycle action is recorded, including **refused** attempts —
those carry `action = 'ROLE_REQUIRES_SUPER_ADMIN'` and a `detail` naming what
was tried. A rising count of refusals is worth investigating.

(Requires migration 017. Before it, refused attempts were silently lost.)

## Rotate secrets

| Secret | How | Blast radius |
| --- | --- | --- |
| `CRON_SECRET` | `openssl rand -hex 32` → set in Vercel → redeploy | none; only Vercel calls the cron |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | see below | **every user must reconnect Google Calendar** |
| Supabase service role key | Supabase dashboard → rotate | none, app re-reads env |
| `RESEND_API_KEY` | Resend dashboard → new key in Vercel | email stops until set |

### Rotating `GOOGLE_TOKEN_ENCRYPTION_KEY`

Stored refresh tokens are encrypted with this key (AES-256-GCM, `v1:` format).
**Rotating it makes every stored token undecryptable — all users must
disconnect and reconnect Google Calendar.** Prefer leaving it alone; rotate
only if it leaks, and warn users first.

```sql
-- Optional: clear the connections so users get a clean reconnect prompt
DELETE FROM user_google_tokens;
```

## Realtime stopped updating

Work down this list:

1. **Is the table published?** A table missing from `supabase_realtime`
   never fires, silently, with no error anywhere:

   ```sql
   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
   ```

   Compare against the list in `docs/realtime-qa.md`. Re-run
   `supabase db push` (migration 015) if anything is missing.

2. **Is the client subscribed?** Open the browser console — a healthy
   `taskora-realtime` channel logs `SUBSCRIBED`. Repeated `CHANNEL_ERROR` or
   no `SUBSCRIBED` at all usually means a network/proxy issue.

3. **Duplicate channels?** More than one channel per session means every
   event is handled N times. Should be exactly one — assert with
   `node --test tests/e2e/hardening.test.ts`.

4. **Query key mismatch.** If one screen is stale while others update, that
   screen's query key probably isn't the one the handler patches. Compare
   the component's `qk.*` usage with the handler.

5. **Stuck after a drop?** Realtime is a live socket, not a queue — events
   sent while disconnected are not replayed. On reconnect the provider
   invalidates active queries only; navigating to the screen refetches it.

## Migrations

```bash
supabase db push
```

Applied in order. `010` → `013` → `014` are one-time and order-dependent
(`013` must commit before `014` uses `MANAGER`). Never edit an applied
migration — add a new numbered file.