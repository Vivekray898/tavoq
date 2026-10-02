# Google Calendar sync & daily reminders — setup guide

Two features ship in this change:

1. **Google Calendar sync** — each employee connects their own Google
   account once; their assigned tasks are then pushed to their calendar
   and kept current.
2. **Daily reminders** — a Vercel cron notifies every active employee
   about tasks that are due today or already overdue.

Everything runs on free tiers. This guide covers the one-time setup.

---

## 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click the project picker at the top → **New Project**.
3. Name it (e.g. `taskora`) and click **Create**.

If you already have a project you want to reuse, skip this and just
note the project name — the next step happens inside it.

---

## 2. Enable the Google Calendar API

1. Make sure the new project is selected in the picker.
2. Go to **APIs & Services → Library**.
3. Search for **Google Calendar API**.
4. Click it, then click **Enable**.

The API is free with a quota of **1,000,000 requests/day** — this
feature uses a handful per sync, so the limit is never a concern.

---

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. If asked, choose **External** (your employees sign in with their own
   Google accounts, not a Workspace domain).
3. Fill in the required app information:
   - **App name**: `Taskora`
   - **User support email**: your email
   - **Developer contact email**: your email
4. Under **Data Access**, click **Add or remove scopes** and add both:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar`
5. Save.

### About app verification

While the consent screen is in **Testing**, Google only issues refresh
tokens to accounts listed under **Test users** (up to 100, with no
review required). That is enough for an internal tool.

To connect more than 100 employees, or to avoid the "Google hasn't
verified this app" warning, submit the app for verification:

- **Publish → In production** and add your app's domain under
  **App domain → Application home page**.
- Add a **privacy policy** URL and a **terms of service** URL.
- Complete the **Data Access** and **scopes** sections, then submit.

Scoping note: we only ever create and update the user's **own** task
events, so `calendar.events` is the narrower scope and the right one to
request first. `calendar` is included because the incremental sync reads
event metadata and the `events.watch` endpoint needs it.

---

## 4. Create OAuth 2.0 credentials

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. **Application type: Web application**.
4. Under **Authorized redirect URIs**, add:
   - Production: `https://<your-domain>/api/auth/google/callback`
   - Local dev: `http://localhost:3000/api/auth/google/callback`
5. Click **Create**.
6. Copy the **Client ID** and **Client secret** — you need both.

The redirect URI must match exactly, including scheme, host, path and
any trailing slash. A mismatch here is the most common cause of a
callback that bounces back with `?gcal=invalid`.

---

## 5. Why `access_type=offline` and `prompt=consent` are required

These two parameters are sent on every connect request
(`lib/actions/google-calendar.ts`):

- **`access_type=offline`** tells Google to issue a **refresh token**,
  a long-lived credential that lets the server keep syncing after the
  user closes the tab. Without it you get an access token that expires
  in an hour and no way to renew it.
- **`prompt=consent`** forces the consent screen to appear every time.
  Google only issues a refresh token on the *first* authorization, so
  without this a user who revokes and re-approves the app would
  silently get no refresh token and syncing would break for them.

`prompt=consent` is not sufficient on its own — an app in *Testing* still
only issues refresh tokens to listed test users, which is why step 3
matters.

---

## 6. Environment variables

Add these in **Settings → Environment** (or `freebuff-deploy env set`
for production). Do not commit them.

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes | From the credentials page |
| `GOOGLE_CLIENT_SECRET` | yes | From the credentials page |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | yes | `openssl rand -base64 32` — encrypts refresh tokens at rest |
| `CRON_SECRET` | yes | `openssl rand -hex 32` — authorizes the cron endpoint |
| `GOOGLE_WEBHOOK_TOKEN` | no | Shared value the webhook checks; defaults to `taskora` |
| `GOOGLE_WEBHOOK_URL` | no | Defaults to `<NEXT_PUBLIC_APP_URL>/api/calendar/webhook` |
| `NEXT_PUBLIC_APP_URL` | yes (already set) | Used to build the redirect URI |

Generate the two random values:

```bash
openssl rand -base64 32   # GOOGLE_TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

### Why the encryption key matters

`user_google_tokens.refresh_token` holds a credential that grants
standing access to a user's calendar. `lib/crypto/google-token.ts`
encrypts it with AES-256-GCM before it reaches the database, so a leaked
anon key or SQL injection does not hand over every connected account.

**Set this before connecting any account.** Tokens encrypted under a
different key cannot be decrypted, so changing the key later means
every employee has to reconnect.

---

## 7. Apply the database migration

```bash
supabase db push
```

Or paste `supabase/migrations/012_google_calendar_integration.sql` into
the Supabase SQL editor and run it.

This creates `user_google_tokens`, adds `tasks.google_event_id`, and
creates `daily_reminder_log`. Migrations `010`, `011` and `012` must be
applied in order — `011`'s trigger references `payout_amount` from
`010`.

---

## 8. Deploy and set the cron

`vercel.json` already declares the schedule:

```json
{ "crons": [{ "path": "/api/cron/daily-reminders", "schedule": "0 5 * * *" }] }
```

`0 5 * * *` is **05:00 UTC = 10:30 IST**, which lines up with how the
app renders deadlines. Change it if you want a different hour.

Vercel Cron is available on all plans, but the **Hobby** tier allows
only **one cron job per day** — this schedule fits. The endpoint returns
401 unless the request carries `Authorization: Bearer $CRON_SECRET`.

Deploy, then confirm the schedule registered:

```bash
freebuff-deploy status
```

---

## 9. Verify

1. **Connect** — sign in, go to `/profile`, click **Connect** under
   Google Calendar. You should be sent to Google and returned to
   `/profile?gcal=connected` with a success toast.
2. **Sync** — click **Sync now**. Your assigned, non-completed tasks
   appear on your calendar as all-day events on their deadline.
3. **Re-sync is idempotent** — click **Sync now** again. You should see
   "Calendar is already up to date" and no duplicate events.
4. **Reconnect safely** — disconnect, then reconnect. A fresh token is
   issued and the sync cursor resets, so the next sync re-creates events
   in place.
5. **Cron** — trigger it manually:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://<your-domain>/api/cron/daily-reminders
   ```

   You should get JSON like
   `{"ok":true,"employees":3,"notified":2,"dueToday":1,"overdue":1}`.
   Run it twice — the second run reports `notified: 0` because of the
   `daily_reminder_log` de-duplication.

---

## Troubleshooting

**Callback returns `?gcal=invalid`**
The redirect URI in the Google credentials doesn't match the one the
app builds, or the state cookie expired (10-minute TTL) or was blocked.
Check the exact URI in step 4, and that you're on the same browser that
started the flow.

**"Google didn't return a refresh token"**
The app is in *Testing* and this Google account isn't a test user
(step 3), or the user previously authorized the app and `prompt=consent`
isn't reaching Google. Add the account as a test user and reconnect.

**Callback returns `?gcal=unauthorized`**
The state cookie was set by a different sign-in than the one completing
the flow. Sign out, sign back in, and start again.

**Sync reports errors for individual tasks**
Usually a revoked or expired grant. Disconnect and reconnect; the token
is re-encrypted and the cursor reset. Per-task failures don't stop the
rest of the sync — the response lists them in `errors`.

**Calendar changes made in Google don't appear in Taskora**
Expected. The inbound sync only acts on **deletions**, which clear the
local mapping so the next sync re-creates the event. Taskora owns task
fields, so edits made in Google are intentionally not imported — they'd
be overwritten on the next push.

**Sync always does a full re-sync**
Google returns **410 Gone** when the `sync_token` is too old. The code
catches this, clears the cursor and re-syncs in full, which is the
documented recovery. If it happens constantly, the daily cron is
renewing the watch channel isn't happening yet — see the note in the
PR description.

**Cron returns 401**
`CRON_SECRET` is unset or differs between the environment Vercel runs
the cron in and the one you curl with.
