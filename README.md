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

Taskora separates **role** (`ADMIN` / `EMPLOYEE`) from **status**
(`PENDING` / `ACTIVE` / `SUSPENDED`).

- **Every new signup — including Google OAuth — starts as
  `role = NULL, status = PENDING` with no application access.**
  There is no automatic admin promotion of any kind.
- Pending and suspended users are blocked server-side at three layers:
  the Next.js proxy (`proxy.ts`), every server action
  (`requireActiveUser/Employee/Admin` in `lib/auth.ts`), and Supabase
  RLS (migrations 005–008).
- Only an **active admin** can approve accounts, change roles, or
  suspend users — and the last active admin cannot be demoted or
  suspended (enforced by the `manage_profile_lifecycle` RPC).

## Creating the First Admin

The first admin must be created **explicitly** — never by login order:

1. Open the app and sign in once with your Google account
2. In Supabase (SQL Editor), promote that exact account:

```sql
UPDATE profiles
SET role = 'ADMIN', status = 'ACTIVE', active = true,
    approved_at = now()
WHERE email = 'you@youragency.com';
```

3. Sign out and back in — you'll land on the admin workspace.

## Adding Employees (Invitations)

1. **Team → Pending → “Invite employee”**
2. Enter their email and role; they receive a link (or share the
   shown link manually)
3. They open the link and sign in with the Google account for that
   exact email address — the account activates with the invited role

Alternatively, uninvited people can sign in on their own — they'll
land on the **pending** page until an admin approves them from the
Team page.

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

### Admin
- Dashboard with stats (active projects, tasks, due today, overdue, payments)
- Client management (CRUD)
- Project management with members and resources
- Task creation with assignment, deadlines, and payouts
- Task review workflow (approve / request revision)
- Payment tracking (mark paid)
- Employee management
- Notifications

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
- Server-side authorization on all server actions
- Employees can only see their own tasks and payment info
- Admin-only access to client/project/task management

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
