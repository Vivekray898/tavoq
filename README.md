# Taskora — Agency Work Management

An internal work-management application for digital marketing agencies. Manage clients, projects, tasks, employees, and payments — all in one place.

## Architecture

```
taskora/
├── app/                          # Next.js App Router pages
│   ├── (auth)/                   # Auth pages (login, signup, etc.)
│   ├── (dashboard)/              # Dashboard layout with sidebar
│   └── api/                      # API routes
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── layout/                   # Sidebar, topbar, mobile nav
│   ├── dashboard/                # Dashboard widgets
│   ├── clients/                  # Client components
│   ├── projects/                 # Project components
│   ├── tasks/                    # Task components
│   └── shared/                   # Shared components
├── lib/
│   ├── supabase/                 # Supabase client utilities
│   ├── actions/                  # Server actions
│   ├── auth.ts                   # Auth helpers
│   ├── email.ts                  # Resend email
│   └── utils.ts                  # Utility functions
├── types/                        # TypeScript types
├── validators/                   # Zod validation schemas
├── supabase/                     # Database migrations & seed data
└── public/                       # Static assets
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| React | React 19 |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui |
| Forms | React Hook Form + Zod |
| Icons | Lucide React |
| Auth + Database | Supabase (PostgreSQL) |
| Email | Resend |
| Language | TypeScript (strict) |
| Package Manager | pnpm |

## Prerequisites

- **Node.js** 18+ (recommended: 20+)
- **pnpm** 9+
- **Supabase** account (free tier works)
- **Resend** account (optional, for email notifications)

## Environment Variables

1. Copy the example file:
   ```bash
   cp .env.local.example .env.local
   ```

2. Fill in the values:
   ```env
   # Supabase (from your Supabase project dashboard → Settings → API)
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

   # Resend (optional — from resend.com)
   RESEND_API_KEY=re_your_api_key
   RESEND_FROM_EMAIL=Taskora <noreply@yourdomain.com>

   # App URL
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

## Supabase Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and API keys from the Settings → API page

### 2. Run Database Migrations

**Option A: Using Supabase Dashboard**

1. Go to your project → SQL Editor
2. Copy and paste the contents of `supabase/migrations/001_initial_schema.sql`
3. Click "Run"

**Option B: Using Supabase CLI**

```bash
# Install Supabase CLI (if not installed)
pnpm add -D supabase

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### 3. Run Seed Data (Optional)

In the SQL Editor, run:
```sql
-- Copy contents of supabase/seed.sql
```

### 4. Configure Auth

In your Supabase Dashboard → Authentication → Providers:
- Enable **Email** provider (should be enabled by default)
- Optionally disable email confirmation for development

## Local Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Account Model & Security

Taskora separates **role** (`SUPER_ADMIN` / `MANAGER` / `EMPLOYEE`) from
**status** (`PENDING` / `ACTIVE` / `SUSPENDED`).

- **Every new signup — including Google OAuth — starts as
  `role = NULL, status = PENDING` with no application access.**
  There is no automatic promotion of any kind.
- Pending and suspended users are blocked server-side at three layers:
  the Next.js proxy (`proxy.ts`), every server action
  (`requireAuth` / `requireStaff` / `requireSuperAdmin` in `lib/auth.ts`),
  and Supabase RLS (migrations 005–016).
- A **manager** runs day-to-day operations but only inside the projects
  they are a member of (`can_manage_project()`).
- Only a **super admin** can change roles, reach settings, or hard-delete
  anything — and the last active super admin cannot be demoted or suspended
  (enforced by the `manage_profile_lifecycle` RPC).
- Refused privilege escalations are recorded in `admin_audit_log` with the
  `ROLE_REQUIRES_SUPER_ADMIN` action.

Full matrix: **[docs/roles.md](docs/roles.md)**.

## Roles

| Role | What it can do |
| --- | --- |
| **SUPER_ADMIN** | Everything: roles, settings, hard deletes, audit log |
| **MANAGER** | Day-to-day ops on their own projects; approve/suspend employees; run payroll |
| **EMPLOYEE** | Their own tasks, comments, submissions and payments |

The matrix is enforced twice — in RLS (the real boundary) and in
`lib/permissions.ts` (the readable mirror the UI and server actions share).
See [docs/roles.md](docs/roles.md) for the capability-by-capability table and
a recipe for adding a role-guarded action.

## Realtime

Changes by any user reach every other open session in about a second,
without a refresh. A single Supabase Realtime channel patches the TanStack
Query cache in place — there is **no polling and no `router.refresh()`**.
Mutations also apply optimistically, rolling back with a toast if the server
refuses.

Setup and the two-browser QA checklist: **[docs/realtime-qa.md](docs/realtime-qa.md)**.

## Google Calendar

Each person's own Google account receives events for **their own tasks only**
— no admin-wide fan-out, so connecting more accounts can never duplicate an
event. Reassigning a task moves the event on the new owner's next sync.

Setup: [docs/google-calendar-setup.md](docs/google-calendar-setup.md).
Ownership model and edge cases: **[docs/google-calendar.md](docs/google-calendar.md)**.

## Cron

`GET /api/cron/daily-reminders` runs daily at **05:00 UTC** (10:30 IST) and
sends one reminder per employee per unfinished task due today or overdue. It
is registered in `vercel.json` and de-duplicated by `daily_reminder_log`, so a
re-run cannot double-notify.

Called by Vercel with `Authorization: Bearer $CRON_SECRET`. Manual run:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/daily-reminders
```

Rotating the secret: generate a new value, set `CRON_SECRET` in Vercel
(Production/Preview/Development), redeploy, and update your shell. No other
secret is affected.

## Creating the First Super Admin

The first super admin must be created **explicitly** — never by login order:

1. Open the app and sign in once with your Google account
2. In Supabase (SQL Editor), promote that exact account:

```sql
UPDATE profiles
SET role = 'SUPER_ADMIN', status = 'ACTIVE', active = true,
    approved_at = now()
WHERE email = 'you@youragency.com';
```

3. Sign out and back in — you'll land on the admin workspace.

Migrations 013–014 renamed the old `ADMIN` value to `SUPER_ADMIN` in place, so
existing admins were migrated automatically.

## Adding Employees (Invitations)

1. **Team → Pending → “Invite employee”**
2. Enter their email and role; they receive a link (or share the
   shown link manually)
3. They open the link and sign in with the Google account for that
   exact email address — the account activates with the invited role

Alternatively, uninvited people can sign in on their own — they'll
land on the **pending** page until a manager or super admin approves
them from the Team page.

### Legacy email/password users signing in with Google

In Supabase → Authentication → Providers → Google, enable
**“Link Google account to existing user by email”** (or
“Automatic linking” depending on dashboard version). Existing
employees then keep the same profile, tasks, payments, and history
when they first use Google sign-in. Without it, Google sign-in for an
email that already exists is rejected with a clear message.

## Push Notifications (optional)

Real system notifications (PWA Web Push) need VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` (see `.env.local.example`). Users opt in from the
notification center via “Enable notifications”. Without keys, the
in-app notification center still works; browser push is skipped.

## Deployment (Vercel)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) and import your repository
3. Add environment variables
4. Deploy

```bash
# Or deploy via CLI
pnpm add -g vercel
vercel
```

### Production Checklist

- [ ] Set all environment variables in Vercel
- [ ] Run database migrations on production Supabase
- [ ] Configure email domain in Resend (for production email)
- [ ] Set `NEXT_PUBLIC_APP_URL` to your production URL
- [ ] Enable email confirmation in Supabase Auth
- [ ] Review and test RLS policies

## Android Build (Future)

The mobile app will be built with React Native + Expo. For now, the web app is fully responsive and works well on mobile browsers.

## Key Features

### Super Admin & Manager
- Dashboard with stats (active projects, tasks, due today, overdue, payments)
- Client management (CRUD)
- Project management with members and resources
- Task creation with assignment, deadlines, and payouts
- Task review workflow (approve / request revision)
- Payment tracking (mark paid)
- Employee management — managers see approve/reject, super admins also manage roles
- Notifications

Managers get the same operational surface scoped to their own projects.
Role changes, settings, and hard deletes are super-admin only.

### Employee
- Personal dashboard (due today, needs review, completed, pending payment)
- View assigned tasks with details
- Submit work for review
- View project resources (Google Drive, Canva, etc.)
- Comments on tasks
- See payment status
- Notifications

### Security
- Supabase Row Level Security (RLS) on all tables
- Server-side authorization on every server action
- Employees see only their own tasks and payment info
- Managers are scoped to their projects; role changes and deletes are super-admin only
- Refused privilege escalations are audited

## Database Schema

```
profiles ──────── users (auth.users)
  │
  ├── project_members
  │         │
  │         ▼
  │      projects
  │         │
  │         ├── clients
  │         ├── project_resources
  │         └── tasks
  │                ├── task_comments
  │                ├── task_attachments
  │                └── payments
  │
  └── notifications
```

## License

Internal use only. Not for distribution.
