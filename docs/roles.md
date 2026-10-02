# Roles and permissions

Taskora has three roles. They are enforced in two places that must agree:

- **RLS** (`supabase/migrations/013_role_hierarchy.sql`) — the real security
  boundary. Even a hand-crafted request cannot get around it.
- **`lib/permissions.ts`** — a pure mirror of the same matrix, imported by the
  server actions and the UI so a control is never shown-but-rejected, or
  hidden-but-allowed.

## The matrix

| Capability | SUPER_ADMIN | MANAGER | EMPLOYEE |
| --- | --- | --- | --- |
| Manage clients (create/edit/archive) | ✅ | ✅ | ❌ |
| Manage projects (create/edit/archive) | ✅ | ✅ own projects only | ❌ |
| Manage project members | ✅ | ✅ own projects only | ❌ |
| Create / edit tasks | ✅ | ✅ own projects only | ❌ |
| Assign tasks | ✅ | ✅ own projects only | ❌ |
| Change any task status | ✅ | ✅ own projects only | own tasks only |
| Approve / reject employee profiles | ✅ | ✅ EMPLOYEE targets only | ❌ |
| Suspend / reactivate employees | ✅ | ✅ EMPLOYEE targets only | ❌ |
| Change a user's role | ✅ | ❌ | ❌ |
| Approve/suspend a MANAGER or SUPER_ADMIN | ✅ | ❌ | ❌ |
| Manage payments (create/edit/mark paid) | ✅ | ✅ | ❌ |
| View all payments | ✅ | ✅ | own only |
| Invite employees | ✅ | ✅ as EMPLOYEE only | ❌ |
| Manage settings | ✅ | ❌ | ❌ |
| Hard-delete tasks / projects / clients | ✅ | ❌ | ❌ |
| Read admin audit log | ✅ | ✅ | ❌ |

**Super admin** owns the org: configuration, role changes and anything
irreversible.

**Manager** runs day-to-day operations, but only inside the projects they are a
member of. "Own projects only" is enforced by
`public.can_manage_project(project_id)` in RLS and by
`assertCanManageProject()` in the actions.

**Employee** is unchanged from before.

## Guards

| Guard | Allows |
| --- | --- |
| `requireAuth()` | any active account |
| `requireStaff()` | active super admin **or** manager |
| `requireManager()` | alias of `requireStaff()` |
| `requireSuperAdmin()` | active super admin only |
| `assertCanManageProject(id)` | super admin, or manager who is a member |

`requireStaff()` alone does **not** grant project-wide power. It answers "is this
person staff?"; `assertCanManageProject()` answers "is this their project?".
Project-scoped mutations call both.

### Deprecated

`requireAdmin()` is deprecated and now resolves to `requireSuperAdmin()`. It
survives one release so existing call sites keep compiling, but it is ambiguous
under the new model — migrate deliberately to either `requireSuperAdmin()`
(configuration/destructive) or `requireStaff()` (operational).

Also deprecated: `requireActiveAdmin`, `requireActiveManager`, `requireActiveStaff`.

## The escalation rule

The rule that matters most, and the easiest to get wrong:

> A manager may only ever act on `EMPLOYEE` targets, and may only ever **grant**
> `EMPLOYEE`.

It is not enough to check the *action*. `APPROVE` writes `profiles.role` as well
as `profiles.status`, so a manager who could approve a pending user could pass
`requested_role = 'SUPER_ADMIN'` and mint an org owner. Both the action
(`canManageProfile`) and the RPC (`manage_profile_lifecycle`) therefore clamp on
the role being **granted**, not the action name.

Guarding the action name alone is the bug this check exists to catch.

## Last-active-super-admin protection

The org can never be left without an active super admin. Demoting or suspending
the final one raises inside `manage_profile_lifecycle()`. Create a second super
admin first.

Refused attempts against a privileged target are written to `admin_audit_log`
with the `ROLE_REQUIRES_SUPER_ADMIN` action before the error is raised.

## Running the tests

```bash
pnpm test          # authorization matrix (no database needed)
pnpm typecheck
pnpm lint
```

`tests/roles.db.test.ts` additionally exercises the helpers and the lifecycle RPC
against a live database. It **skips with the reason** rather than failing when no
database is reachable, or when the credentials point at a database where
migration 014 has not been applied — that is a state of the environment, not a
defect in the code.

To run it against your project:

```bash
export SUPABASE_URL="https://<your-project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
pnpm test
```

For the per-role RLS assertions (a manager reading another project's rows, an
employee reading another's payments) you additionally need signed-in clients, which
require real test accounts; those cases are documented inline in the file.

## Migration

Applied in two files, in order after `012`:

- `013_role_enum_values.sql` — widens the enum only: renames `ADMIN` to
  `SUPER_ADMIN` in place and adds `MANAGER` and `ROLE_REQUIRES_SUPER_ADMIN`.
- `014_role_hierarchy.sql` — the helpers, RLS policies and the reworked
  `manage_profile_lifecycle()`.

**The split is not cosmetic.** Postgres refuses to use an enum value in the same
transaction that created it (`ERROR 55P04: unsafe use of new value "MANAGER"`), so
a value must be committed by the end of one migration before the next may reference
it. Every `ADD VALUE` lives in 013; only 014 consumes them.

```bash
supabase db push          # applies 010 → 014 in order
```

Renaming rather than recreating the type keeps all four dependent columns and the
`manage_profile_lifecycle()` signature valid, and moves no data. Both files are
idempotent.

`pnpm test` includes a static check (`scripts/verify-migration-enum-order.mjs`)
that fails if any migration both adds an enum value and uses it, so this split
cannot silently regress.

A down-migration is documented in a comment at the top of each file. Reverting is
lossy: a `MANAGER` cannot be mapped back to a distinct former role.