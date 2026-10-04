-- 026_preserve_payment_ledger_history.sql
--
-- SAFETY REPAIR. This migration creates, updates and deletes NO rows.
-- It only re-points three foreign keys so that deleting an ordinary
-- business record can no longer destroy financial history.
--
-- ---------------------------------------------------------------------
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------
-- Audit of the live schema (2026-10-04) found the ledger had four
-- independent paths by which money records silently disappeared:
--
--   1. payments_task_id_fkey        -> tasks      ON DELETE CASCADE
--   2. payments_employee_id_fkey   -> profiles   ON DELETE CASCADE
--   3. payment_events_payment_id_fkey -> payments ON DELETE CASCADE
--
-- plus a two-hop path that reached the same place:
--
--   DELETE project -> tasks (CASCADE) -> payments (CASCADE)
--
-- The first is actively reachable from the product. lib/actions/tasks.ts
-- deletes task rows with .from("tasks").delete().eq("id", id), so
-- deleting a task in the UI destroyed the payment rows it generated,
-- with no confirmation, no soft delete and no audit record -- the audit
-- record being destroyed too, because activity_task_id_fkey is also
-- ON DELETE CASCADE.
--
-- A payroll ledger must outlive the work item that earned it.
--
-- ---------------------------------------------------------------------
-- CONSTRAINT NAMES ARE VERIFIED, NOT ASSUMED
-- ---------------------------------------------------------------------
-- Every name below was read out of pg_constraint on the live database
-- before this file was written. If Postgres auto-named them differently
-- on a recreated database, ALTER TABLE ... DROP CONSTRAINT would fail
-- loudly rather than silently do nothing.
--
-- ---------------------------------------------------------------------
-- CHANGE 1 - payments.task_id: CASCADE -> SET NULL
-- ---------------------------------------------------------------------
-- The requested behaviour, unchanged:
--
--     Task deleted -> Payment remains, payments.task_id = NULL
--
-- task_id is already nullable (migration 009 relaxed the original
-- NOT NULL when it introduced standalone payments), so no column
-- alteration is needed and no rewrite of the table occurs.
--
-- ---------------------------------------------------------------------
-- CHANGE 2 - payments.employee_id: CASCADE -> RESTRICT
-- ---------------------------------------------------------------------
-- Deliberately NOT SET NULL. Setting it to NULL would keep the row but
-- destroy the only thing that makes a payroll row meaningful: who was
-- owed the money. An unattributable payment in a payroll ledger is
-- close to a deleted one.
--
-- RESTRICT instead refuses the hard delete of a person who has pay
-- history. That is the correct posture because the product already has
-- the right tool for offboarding: manage_profile_lifecycle SUSPENDS a
-- profile, preserving the row and every reference to it. Hard delete is
-- not a supported operation for anyone with financial history.
--
-- No application code path deletes a profile -- the only such deletes in
-- the repository are test teardown for fixtures that hold no payments --
-- so this adds a guard without breaking a real flow.
--
-- ---------------------------------------------------------------------
-- CHANGE 3 - payment_events.payment_id: CASCADE -> RESTRICT
-- ---------------------------------------------------------------------
-- payment_events is the append-only audit trail: who paid, who reversed,
-- who cancelled, when. Cascading it means deleting a payment erases the
-- record of what was done to it, which is precisely the evidence a
-- ledger exists to keep.
--
-- RESTRICT means a payment that has history cannot be deleted at all.
--
-- ---------------------------------------------------------------------
-- REPORTED BUT NOT CHANGED
-- ---------------------------------------------------------------------
-- These are real and are left alone deliberately. Each needs a product
-- decision rather than a unilateral schema edit:
--
--   activity_task_id_fkey  -> tasks ON DELETE CASCADE
--       Deleting a task still erases its own activity history. This is
--       why the two lost payments could not be traced: the evidence
--       was removed by the same cascade as the money.
--
--   tasks_project_id_fkey  -> projects ON DELETE CASCADE
--       Deleting a project still deletes its tasks. After change 1 the
--       payments survive, but the work items do not.
--
--   payments_payee_fkey    -> profiles ON DELETE SET NULL
--       payee is NOT NULL, so this constraint contradicts itself:
--       any attempt to delete a referenced profile fails with a
--       not-null violation rather than a clean referential error. It
--       happens to fail safe today, but by accident.
--
-- ---------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------
--     ALTER TABLE public.payments
--       DROP CONSTRAINT payments_task_id_fkey,
--       ADD  CONSTRAINT payments_task_id_fkey
--         FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--
--     ALTER TABLE public.payments
--       DROP CONSTRAINT payments_employee_id_fkey,
--       ADD  CONSTRAINT payments_employee_id_fkey
--         FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--
--     ALTER TABLE public.payment_events
--       DROP CONSTRAINT payment_events_payment_id_fkey,
--       ADD  CONSTRAINT payment_events_payment_id_fkey
--         FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;
--
-- Restoring CASCADE re-arms the data-loss paths. Prefer leaving the
-- ledger safe and repairing the UI instead.
-- ---------------------------------------------------------------------

-- Each migration file runs inside a transaction supplied by the Supabase CLI.
-- No explicit BEGIN/COMMIT here: 023-025 do not use one either, and a nested
-- BEGIN only emits a "there is already a transaction in progress" warning.

-- CHANGE 1: a payment outlives the task that earned it.
ALTER TABLE public.payments
  DROP CONSTRAINT payments_task_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;

-- CHANGE 2: a person with pay history cannot be hard-deleted out from
-- under that history. Deactivation (SUSPEND) remains the offboarding path.
ALTER TABLE public.payments
  DROP CONSTRAINT payments_employee_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- CHANGE 3: a payment that has audit history cannot be deleted.
ALTER TABLE public.payment_events
  DROP CONSTRAINT payment_events_payment_id_fkey;
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT;
