# Publishing the Google OAuth app to Production

**Why this matters.** With the consent screen in **Testing** + user type
**External**, Google revokes refresh tokens after **7 days**. Every user would
have to re-consent weekly, and the symptom ("my calendar randomly stopped
syncing") looks like an app bug. Publishing removes the expiry permanently.

Testing + **Internal** does not expire. Internal is only available if the Cloud
project belongs to a Google Workspace organisation; it is free and needs no
verification. If that applies to you, prefer it.

---

## What you already have

- One scope: `https://www.googleapis.com/auth/calendar.events`
- One redirect URI: `{APP_URL}/api/auth/google/callback`
- The code already handles the failure mode this would have caused —
  `google_connections.status = 'NEEDS_RECONNECT'` surfaces "your access
  expired — Reconnect" instead of silently disconnecting.

`calendar.events` is classified **sensitive** by Google, so verification is
required before the app can be published.

---

## 1. Branding & data (the verification prerequisites)

**Google Cloud Console → APIs & Services → OAuth consent screen → Branding**

| Field | Value |
|-------|-------|
| App name | `Taskora` (shown verbatim on the consent screen) |
| User support email | a monitored address |
| Developer contact email | a monitored address |
| Application home page | `https://YOUR_APP_URL` |
| Application privacy policy | `https://YOUR_APP_URL/privacy` |

The home page and privacy policy URLs **must resolve publicly**. Google
fetches them. If either 404s, verification is rejected.

## 2. Domain verification

**OAuth consent screen → Branding → Verified domains → Add**

Add `YOUR_APP_URL`'s bare domain (no `https://`). Prove ownership via DNS TXT,
Google Search Console, or an `<meta name="google-site-verification">` tag.
Deploy first — verification crawls the live site.

## 3. Scope justification

**OAuth consent screen → Data Access**

Only `calendar.events` should be listed. Prepare one sentence for each
question the form asks:

> **Why does Taskora request Calendar event scope?**
> Taskora writes events onto the signed-in user's own calendar to mirror
> tasks assigned to them. It creates, updates and deletes **only** events it
> created itself (each tagged with the originating task id). It never reads
> calendars the user has not shared, and never reads existing event content.

Adding a scope later requires re-verification, so add what you need now.

## 4. Add test users (still Testing)

**OAuth consent screen → Test users → Add users** — up to 100. Add yourself and
the team so you can keep testing while verification is pending.

## 5. Request verification

**OAuth consent screen → Publishing status → Publish app**

Requires:
- Branding complete (step 1)
- A verified domain (step 2)
- A **demo video** (YouTube, unlisted is fine) showing: sign in → connect
  Google Calendar → grant consent → a task appears on the calendar → click
  "Sync now" → the event updates.
- Written justification for each sensitive scope.

Verification usually takes a few days to a few weeks. **Keep the app in
Testing** while it is pending, and keep the test users listed.

## 6. Confirm the redirect URI

**APIs & Services → Credentials → your OAuth 2.0 Client ID → Authorized
redirect URIs**

Must be exactly `https://YOUR_APP_URL/api/auth/google/callback` — protocol,
host, path, **no trailing slash**. A mismatch presents as a generic
"Couldn't connect", not as a redirect error.

## 7. After approval

1. **OAuth consent screen → Publish status** should read *In production*.
2. Remove test users (optional; up to 100 allowed either way).
3. Deploy the trimmed scope change (`calendar.events` only). **Everyone must
   re-consent once** — the previous grant included a broader scope that is no
   longer requested.
4. Verify: revoke access at Google Account → Security → Third-party access,
   reconnect, confirm `google_connections.status` returns to `ACTIVE`.

---

## Verifying the fix took effect

```sql
-- Before: a user who has been disconnected for a week
SELECT user_id, status, connected_at, last_error FROM google_connections;
```

| Symptom | Meaning |
|---------|---------|
| `ACTIVE`, recent `connected_at` | Working |
| `NEEDS_RECONNECT`, `last_error = 'invalid_grant'` | Grant expired or revoked — the UI will prompt Reconnect |
| Row exists but `NEEDS_RECONNECT` forever | The reconnect write is not clearing it — check `handleGoogleCallback` |

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `redirect_uri_mismatch` | Trailing slash, http vs https, or wrong host |
| "Access blocked: app not verified" | Still Testing, and the signed-in account is not a test user |
| `invalid_grant` after ~7 days | Still Testing + External |
| `403 insufficientPermissions` | A new endpoint needing more than `calendar.events` — check the guard test in `tests/google-calendar-phase3.test.ts` |
