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

`tests/roles.db.test.ts` additionally exercises RLS and the lifecycle RPC against
a live database. It **skips** rather than fails when none is reachable. To run
it:

```bash
supabase start                                       # needs Docker
export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o env \
  | grep SUPABASE_SERVICE_ROLE_KEY | cut -d= -f2- | tr -d '"')"
pnpm test
```

## Migration

`supabase/migrations/013_role_hierarchy.sql`, applied after `012`. It renames the
`ADMIN` enum value to `SUPER_ADMIN` in place rather than recreating the type,
which keeps every dependent column and the `manage_profile_lifecycle()` signature
valid, and moves no data. It is idempotent — running it twice is a no-op.

A down-migration is documented in a comment at the top of the file. Reverting is
lossy: a `MANAGER` cannot be mapped back to a distinct former role.