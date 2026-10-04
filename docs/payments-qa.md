# Payments QA checklist — Phase 4

Manual verification for the payment ledger. Steps 0–1 are for **Phase 4A**
(data model, RPC, RLS, audit). Steps 2+ open as later lettered steps ship.

Automated coverage: `tests/payments-ledger.test.ts` (69 tests) —
money rounding, status resolution, adjustment folding, and assertions over
the text of `supabase/migrations/025_payment_ledger.sql`.

> Read [payments.md](payments.md) first for the ledger rules.

---

## 0. Apply the migrations — do this first

`023`, `024` and `025` are all **unapplied**. Apply in order.

**Supabase dashboard**
1. <https://supabase.com/dashboard> → pick the project
2. Left sidebar → **SQL Editor** → **New query**
3. Paste `supabase/migrations/023_push_delivery_and_preferences.sql` → **Run**
4. Repeat for `024_google_connections_and_calendar_events.sql` → **Run**
5. Repeat for `025_payment_ledger.sql` → **Run**

Each is idempotent, so a re-run is safe.

**Verify**

- [ ] `mark_payments_paid`, `get_payments_summary` and `payment_events`
      all appear in the OpenAPI schema (command in
      [payments.md §8](payments.md#verify-it-landed))
- [ ] No errors or warnings in the SQL Editor run
- [ ] `supabase db push` reports all migrations applied and exits 0

---

## 1. Phase 4A — data model, RLS, audit

### 1.1 The backfill (no data lost)

- [ ] **All 4 existing payments still present**, with unchanged ids
- [ ] `amount_paise === amount × 100` on every row (5000 / 6000 / 2000 / 1000)
- [ ] The 3 rows with a `paid_at` show `status = 'PAID'` and
      `payment_method = 'OTHER'`
- [ ] The row without `paid_at` shows `status = 'PENDING'`
- [ ] Every row has a non-null `type` and `payee`
- [ ] `project_id` is populated for task-linked rows, null for the custom one

The UI should look **identical** to before. Nothing here is user-visible yet
except the status badge wording.

### 1.2 Money precision

- [ ] A bonus of ₹500 records and displays as **+₹500.00**
- [ ] A deduction of ₹500 records and displays as **−₹500.00** (or `-₹500.00`)
      — this is the signed-amount rule; if a deduction is rejected outright,
      the `payments_amount_positive` constraint is unscoped and is a bug
- [ ] An amount of ₹0 is rejected by the DB
- [ ] A ₹1,00,000 payment renders as **₹1,00,000.00** (Indian grouping),
      not ₹100,000.00
- [ ] Three payments of ₹0.01 sum to exactly **₹0.03**

### 1.3 Status is stored, not inferred

- [ ] Marking a payment paid sets `status`, `paid_at`, `paid_by` **and**
      `payment_method` together
- [ ] A `PAID` payment can no longer be edited in place
- [ ] Cancelling requires a reason; a blank reason is refused
- [ ] A cancelled payment appears in **no** total — not pending, not paid

### 1.4 Permissions (the manual pass `tests/payments-ledger.test.ts` cannot do)

Sign in as each role in turn. Use two different employees so a cross-read
is actually possible.

**As an EMPLOYEE**
- [ ] Sees **only** their own payments — verify by opening the browser
      devtools Network tab and reading the `payments` REST response
- [ ] Cannot mark anything paid
- [ ] Cannot see another employee's payment by guessing its id in the URL

**As a MANAGER**
- [ ] Sees payments for projects they manage
- [ ] **Cannot** see or pay a payment in a project they do **not** manage
- [ ] Can mark paid only within their own projects

**As a SUPER_ADMIN**
- [ ] Sees all payments
- [ ] Can cancel a PAID payment, with a reason
- [ ] Can reverse a payment (returns it to PENDING, clears paid_*)

### 1.5 Double-pay protection

- [ ] Paying the same payment twice reports **"already paid"** and does not
      move money twice
- [ ] Bulk-paying a set that includes an already-paid row completes for the
      rest and reports the skipped one
- [ ] *(Concurrency)* Two browser windows, same payment, both click
      "Mark paid" → exactly one succeeds. The other reports already-paid.

### 1.6 Audit trail

- [ ] Every create / pay / reverse / cancel writes a `payment_events` row
- [ ] The event records the actor, from/to status, and a timestamp
- [ ] `payment_events` has **no** UPDATE or DELETE path anywhere in the UI
- [ ] An employee can read events for their own payments only

---

## 2. Phase 4B — payments page UI

Automated: `tests/payments-ui.test.ts` (40 tests).

### 2.1 Metrics strip (the week-card bug)

- [ ] **"Paid this week" counts ONLY payments paid this week.** Pay one
      payment today and the caption must read "1 payment this week" — not
      the all-time count. This was the reported bug.
- [ ] "Paid this month" counts only this month
- [ ] Both cards show an up/down delta against the previous period
- [ ] "Total paid" is the only card using an all-time count
- [ ] Cancelled payments appear in no card's amount

### 2.2 Employee labels

- [ ] A named employee shows their name everywhere (table, mobile card,
      detail sheet, by-employee tab, employee picker)
- [ ] **No cell ever shows "EMPLOYEE"** — set an employee's `full_name`
      to null, reload, and confirm an email-derived name appears
- [ ] The same person shows the SAME label on every screen, including the
      employee FILTER dropdown and the by-employee tab
- [ ] No initials-only labels anywhere
- [ ] No "Unassigned" appears for an employee who merely lacks a name
      (that label is only correct when no employee is attached at all)

### 2.3 Date column

- [ ] A paid row is labelled **"Paid on"**; a pending row **"Created"**
- [ ] The desktop table and the mobile card use the same wording
- [ ] Hovering shows the exact timestamp; the wording is visible without
      hovering (no tooltip-only labels)

### 2.4 Tabs

- [ ] All / Pending / Paid / Cancelled / By employee, each with a count
- [ ] The Cancelled tab is reachable — before step B, cancelled payments
      were only visible in totals
- [ ] Counts include 0 rather than hiding the tab

### 2.5 Filters persist in the URL

- [ ] Setting filters changes the URL (`/payments?tab=pending&type=TASK`)
- [ ] Reloading that URL restores the same view
- [ ] Sharing the URL shows the same rows for a colleague
- [ ] Browser Back returns to the previous filter set
- [ ] Clearing filters returns to a clean `/payments` with no params
- [ ] Typing in search does NOT scroll the page to the top

### 2.6 Selection and bulk

- [ ] Cancelled rows carry no checkbox and cannot be selected
- [ ] "Select all N pending" selects only rows matching the current filter
- [ ] Only PENDING rows are selectable (paid/cancelled have no checkbox)
- [ ] Clicking again clears the selection

### 2.7 Method badge

- [ ] Paid rows show a method badge ("Other" until step C adds the picker)
- [ ] Pending rows show no method badge

### 2.8 Sub-line

- [ ] The grey line under a title starts with "Task" or "Custom"
- [ ] It reads identically on desktop and mobile

## 3. Remaining Phase 4 steps

Not yet written — checkboxes open as each step lands.

- [ ] **C** — mark-paid dialog, bulk actions, Zod validation
- [ ] **D** — detail drawer with the `payment_events` timeline, by-employee tab
- [ ] **E** — CSV export, per-employee statements
- [ ] **F** — employee "My payments" page

## 4. Known issues still open (do not treat as regressions in 4A/4B)

- ~~The "Paid this week" card showed an all-time count.~~ **Fixed in 4B**
  and pinned by a test.
- `payment_method` is written as `OTHER` because the method picker arrives
  in step C. Existing PAID rows are legitimately `OTHER`.
- The `payment-proofs` Storage bucket does not exist yet — needed in step C.