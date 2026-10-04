# Payments — the manual ledger

How Taskora records money. Read this before changing anything in
`lib/actions/payments.ts`, `lib/payments/`, or the payments migrations.

---

## 1. Scope: there is no payment gateway

Taskora **does not move money**. Employees are paid outside the app — UPI,
bank transfer, or cash — and the payment is *recorded* here afterwards.

Deliberately **out of scope**, and not planned:

- Razorpay, Stripe, PayU or any other gateway
- Webhooks, refunds, chargebacks, settlement reconciliation
- Payout APIs, vendor onboarding, KYC
- Invoicing, GST, TDS, payslips as legal documents

The app is a **ledger of what a human decided to pay**, and its whole job
is to be trustworthy about that: exact amounts, an explicit status, and an
audit trail that cannot be quietly edited. If a feature needs the app to
*initiate* a payment, it does not belong here.

---

## 2. Money is stored in integer paise

`payments.amount_paise BIGINT` is the authoritative amount, and every
total is computed from it. 100 paise = ₹1.

Rupee floats are what the column predating this (`payments.amount
NUMERIC(10,2)`) used, and NUMERIC→float conversion in JavaScript is
exactly where payroll totals drift: a thousand rows of `19.99` summed as
floats land on something visibly wrong, and `0.1 + 0.2 !== 0.3`. Paise move
the boundary into Postgres, where integer arithmetic is exact.

### The dual-write window

`amount` (NUMERIC) is **kept and kept in sync** by a `BEFORE INSERT OR
UPDATE` trigger that derives it from `amount_paise`:

```sql
NEW.amount := (NEW.amount_paise::NUMERIC / 100);
```

Both are also written by the application, from the same rupee value in
the same object literal. That is not belt-and-braces redundancy: `amount`
has been `NOT NULL` since migration 001 and **nine read paths still sum
it** — `lib/actions/employees.ts`, `lib/actions/dashboard.ts` and the
`getMyEarnings` rollup — so stopping the write would fail every insert
and turn those totals into `NaN`.

> **Where `NEW` is and is not legal.** `NEW`/`OLD` exist only inside a
> trigger function and a `RETURNING` clause. They are **not** in scope in
> a row-level security policy — a policy names the row by the *table*.
> Writing `can_manage_payment(NEW)` in a `WITH CHECK` clause fails with
> `ERROR: 42703: column "new" does not exist`; the correct form is
> `can_manage_payment(payments)`. Migration 025 tripped over exactly that.
>
> A `GENERATED ALWAYS` column would avoid the trigger entirely, but
> Postgres has no `ALTER COLUMN ... SET DATA TYPE GENERATED`, so it would
> mean dropping and re-adding `amount`, losing column privileges and any
> dependent default. Not worth it for a column with one release left.

**`amount` is scheduled for removal.** Once those nine call sites are
migrated to `amount_paise`, a follow-up migration drops the column.
Until that lands:

- always write both, from the same value
- compute new totals from `amount_paise`
- never hand-edit either column directly in SQL

### Rounding

`toPaise()` rounds **half away from zero in both directions**, so
`+0.005 → 1` and `-0.005 → -1`. A naive `Math.round` rounds `-0.5` toward
zero in JavaScript, which would make a negative deduction of half a paisa
flip sign relative to a positive one of the same magnitude — a bug that
would only surface on an employee statement.

### Display

`formatMoney(paise)` → `"₹1,250.00"` using `en-IN` grouping, so ₹100000
reads as **₹1,00,000**, not ₹100,000. Two decimals always, so a column of
amounts aligns. Negative amounts render as `-₹500.00` with the sign
outside the symbol, because a negative amount is a *deduction* (§19) and
must read as one.

`formatCurrency()` in `lib/utils.ts` still exists for the **task-level**
`payout_amount` (a NUMERIC on `tasks`). That column is not migrated in this
phase. The ledger routes through `formatMoney`.

---

## 3. Status

A payments row is `PENDING`, `PAID` or `CANCELLED`, stored in
`payments.status`.

### Why this is not `tasks.payment_status`

The `payment_status` enum (`NOT_APPLICABLE | PENDING | PAID`) belongs to
**`tasks`** and answers "is this task's payout owed?". The ledger answers a
different question and needs `CANCELLED`, which cannot exist on a task.

So migration 025 creates **`payment_ledger_status`**, and the two are
deliberately decoupled: **cancelling a payment never mutates task state.**
They have separate label maps too — `PAYMENT_STATUS_LABELS` vs
`LEDGER_STATUS_LABELS` — and separate badges (`PaymentStatusBadge` vs
`LedgerStatusBadge`). Do not merge them.

### Rules

- **A PAID payment is never edited in place.** Mistakes are fixed by
  *Reverse payment*, which requires a reason, writes an audit event and
  returns the row to `PENDING` with the `paid_*` fields cleared.
- **Cancelling** requires a reason (`payments_cancel_complete`).
- **CANCELLED is neither pending nor paid.** It appears in no total.
  Before this phase, status was inferred as `paid_at ? PAID : PENDING`,
  which made a cancelled payment impossible to express at all.

`resolveLedgerStatus()` prefers the stored column and falls back to the
old `paid_at` inference, so a row written before migration 025 still reads
correctly during rollout.

---

## 4. Adjustments are signed — do not "fix" this

Migration 019 made the ledger **append-only**: a bonus or a deduction is a
**new** `payments` row with a **signed** `amount_paise` and a
`parent_payment_id`, never a mutation of the original. `createPaymentAdjustment`
rejects only zero and renders the sign as `+` / `−`.

So the constraint is:

```sql
CHECK (kind = 'ADJUSTMENT' OR amount_paise > 0)
```

**A blanket `amount_paise > 0` would reject every bonus and every
deduction.** The positivity rule is scoped to `kind = 'PAYMENT'` for
exactly that reason. `amount_paise <> 0` applies to all rows.

### `kind` vs `type`

Two different questions, deliberately kept apart since 019:

| Column | Values | Question it answers |
|--------|--------|---------------------|
| `kind` | `PAYMENT` \| `ADJUSTMENT` | Is this row a payout, or a correction to one? |
| `type` | `TASK_PAYOUT` \| `CUSTOM` \| `BONUS` \| `ADJUSTMENT` | How is this shown to a person? |

Conflating them would make "a custom payment that carries an adjustment"
inexpressible.

**`BONUS` is backfilled as `ADJUSTMENT`.** Historically a bonus *was* an
adjustment with a positive amount — the direction is the sign, not the
type. Backfilling it as `BONUS` would invent history. `BONUS` exists for
new rows only.

---

## 5. Rules enforced in the database

Every rule below is a constraint or an RPC, not just a UI guard. Server
actions re-check them so the user gets a readable message, but the database
is the boundary.

| Rule | Mechanism |
|------|-----------|
| Amount is never zero | `CHECK (amount_paise <> 0)` |
| Payouts positive, adjustments signed | `CHECK (kind = 'ADJUSTMENT' OR amount_paise > 0)` |
| `PAID` ⇒ `paid_at` + `paid_by` + `payment_method` | `CHECK` `payments_paid_complete` |
| `CANCELLED` ⇒ `cancelled_at` + non-blank `cancel_reason` | `CHECK` `payments_cancel_complete` |
| One active task payout per task | **partial unique index** `uq_payments_active_task_payout` |
| Task payout points at a task | `CHECK` `payments_task_payout_has_task` |
| Task payout only payable once APPROVED | `mark_payments_paid` |
| No double-pay under concurrency | `SELECT … FOR UPDATE` in `mark_payments_paid` |

The unique index is **partial** — `AND status <> 'CANCELLED'` — so
cancelling a payment releases the slot and that task's payout can
legitimately be re-issued.

### `mark_payments_paid` is idempotent

Re-running a bulk action returns `'skipped'` for rows that are already
`PAID` rather than erroring or paying twice. It reports one row per input
id with `outcome` ∈ `paid | skipped | cancelled`, so a partially-succeeded
bulk pay is fully visible.

### `mark_payments_paid` is `SECURITY DEFINER`

so the row lock and the status transition are not defeated by per-row RLS
evaluation order. It **re-reads the caller's role from `profiles`** rather
than trusting the JWT, and sets `search_path = public`.

---

## 6. Audit trail

`payment_events` records `CREATED`, `PAID`, `REVERSED`, `CANCELLED` and
`UPDATED` with `from_status`, `to_status`, `metadata` and the actor.

It is **insert-only**: there is *no UPDATE policy and no DELETE policy at
all*, so RLS denies both structurally rather than by convention, and
`UPDATE`/`DELETE` are additionally revoked from `authenticated`. Structural
absence is the point — it cannot drift when someone adds a new operation.

> `service_role` bypasses RLS, so a superuser *could* still mutate an event
> from raw SQL. That escape hatch is intentional and documented; it is not
> a guarantee, and it is why the timeline UI never offers an edit control.

---

## 7. Who can do what

| Actor | Read | Create | Pay | Edit | Cancel / reverse |
|-------|------|--------|-----|------|------------------|
| EMPLOYEE | own rows | — | — | — | — |
| MANAGER | own projects | own projects | own projects | **PENDING only** | — |
| SUPER_ADMIN | all | all | all | PENDING only | ✅ |

Migration 014 granted `is_active_staff() FOR ALL` on payments, which let
any manager edit any payment — including a PAID one. 025 replaces it with
policies that separate read, create, pay, edit-while-pending and cancel.
`can_manage_payment()` scopes a manager to projects they actually manage;
a custom payment has no `project_id` and so needs the explicit staff check.

---

## 8. Deploying migration 025

**It has not been applied to any database yet.** Migrations `023`, `024`
and `025` are all pending. Apply them in order.

### Supabase dashboard (exact click-path)

1. Open <https://supabase.com/dashboard> and pick the project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open the file `supabase/migrations/025_payment_ledger.sql` locally.
4. Select all, copy, paste into the editor.
5. Click **Run** (bottom right).
6. Confirm it reports success. The migration is idempotent, so a re-run is
   safe.

Repeat for `023_push_delivery_and_preferences.sql` and
`024_google_connections_and_calendar_events.sql` — **023 first**.

### Verify it landed

```bash
set -a; source .env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Accept: application/openapi+json" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
      console.log('mark_payments_paid:', !!j.definitions?.mark_payments_paid);
      console.log('get_payments_summary:', !!j.definitions?.get_payments_summary);
      console.log('payment_events:', Object.keys(j.definitions?.payment_events?.properties||{}).join(','));})"
```

All three should print `true` / a column list.

Then confirm the backfill:

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/payments?select=id,amount,amount_paise,status,type,payee" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Every row should have a non-null `status`, `type`, `amount_paise` and
`payee`, with `amount_paise === amount * 100`.

### Expected effects

- All 4 existing rows: `amount_paise` 5000/6000/2000/1000; the 3 with a
  `paid_at` become `PAID` with `payment_method = 'OTHER'`; all become
  `NOT NULL` afterwards.
- No row is modified or deleted. Only new columns are populated.

### Rollback

See the `ROLLBACK` block at the top of the migration file. Every change is
additive — no column or table is dropped or renamed — so a rollback drops
the three new enum types, `payment_events`, the trigger and function, the
new constraints and indexes, and the added columns. The original 11 columns
and all existing rows survive untouched.

---

## 9. Not covered by automated tests

`tests/payments-ledger.test.ts` (69 tests) covers money precision, status
resolution, adjustment folding, and asserts the **text** of migration 025 —
the constraints, indexes, `FOR UPDATE`, the insert-only policy structure,
and the required indexes.

What it does **not** prove, because it cannot without a real Postgres
session: that RLS actually denies a cross-employee read, and that two
concurrent `mark_payments_paid` calls serialise rather than double-pay.
SQL-asserting the policy text is not the same as executing it. Those are
verified by the manual pass in `docs/payments-qa.md` and become an
automated RLS suite in Phase 6.