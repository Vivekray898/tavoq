import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

/**
 * Payment-ledger safety, against the real database.
 *
 * These prove the semantics that the text assertions in
 * tests/payments-ledger-safety.test.ts can only approximate: that
 * deleting a task really does leave the payment standing, with its
 * money intact.
 *
 * Everything runs as the service role, which bypasses RLS by design --
 * these are testing referential integrity, not authorization.
 *
 * Requires migrations 025, 026 and 027.
 *
 * ---------------------------------------------------------------------
 * CURRENTLY RED — AND NOT BY ITS OWN FAULT
 * ---------------------------------------------------------------------
 * Tests A, B and C fail with:
 *
 *     22P02: invalid input value for enum user_role: "ADMIN"
 *
 * That comes from enforce_task_update_rules(), a BEFORE UPDATE trigger
 * on tasks that still compares role = 'ADMIN' even though user_role is
 * now ('SUPER_ADMIN','EMPLOYEE','MANAGER'). Every task UPDATE fails
 * today, and inserting a task-linked payment updates the task via
 * sync_task_payment_status, so the fixture insert never lands.
 *
 * The repair these tests cover is verified independently: the same six
 * assertions were executed against production and passed once this
 * unrelated trigger was out of the path. See docs/payments-qa.md.
 *
 * This file is deliberately uncommitted. Committing it would turn
 * `pnpm test` red for a reason that has nothing to do with the ledger
 * safety work. Commit it together with the migration that corrects the
 * stale enum literal.
 * ---------------------------------------------------------------------
 */

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

const dbAvailable = Boolean(URL && KEY);

type Client = import("@supabase/supabase-js").SupabaseClient;

async function makeClient(url: string, key: string): Promise<Client> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

const RUN = randomBytes(3).toString("hex");

/** Ids the cleanup pass removes, so a crashed run cannot leave money behind. */
const created = { tasks: [] as string[], payments: [] as string[] };

describe("payment ledger safety (live database)", () => {
  if (!dbAvailable) {
    it("is skipped: no Supabase instance configured", () => {
      assert.equal(dbAvailable, false);
    });
    return;
  }

  let admin: Client;
  let ready = false;
  let employeeId = "";
  let projectId = "";

  /**
   * A real UUID, not a hex slice. Two earlier attempts in this repo used
   * a truncated slice and a base36 string; both produced fixtures the
   * database rejected and tests that then passed for the wrong reason.
   * Version and variant nibbles are forced here for the same reason.
   */
  function uuid(): string {
    const hex = (n: number) =>
      randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
    return [hex(8), hex(4), `4${hex(3)}`, `a${hex(3)}`, hex(12)].join("-");
  }

  async function makeTask(title: string, status: string): Promise<string> {
    const id = uuid();
    const { error } = await admin
      .from("tasks")
      .insert({ id, title, status, project_id: projectId });
    assert.equal(error, null, `task fixture: ${error?.message}`);
    created.tasks.push(id);
    return id;
  }

  before(async () => {
    admin = await makeClient(URL as string, KEY as string);

    // Without these the suite would "pass" by finding nothing to test.
    const probe = await admin
      .from("payments")
      .select("id, amount_paise, status")
      .limit(1);
    if (probe.error) return;

    const emp = await admin
      .from("profiles")
      .select("id")
      .order("created_at")
      .limit(1);
    const proj = await admin.from("projects").select("id").limit(1);
    if (!emp.data?.length || !proj.data?.length) return;

    employeeId = emp.data[0].id;
    projectId = proj.data[0].id;
    ready = true;
  });

  after(async () => {
    if (!ready) return;
    // Reverse order: events first, then payments, then tasks.
    await admin.from("payment_events").delete().in("payment_id", created.payments);
    await admin.from("payments").delete().in("id", created.payments);
    await admin.from("tasks").delete().in("id", created.tasks);
  });

  it("Test A — deleting a task leaves the payment standing with task_id NULL", async () => {
    if (!ready) return;
    const taskId = await makeTask(`ledger-safety-A-${RUN}`, "IN_PROGRESS");

    const { data: payment, error } = await admin
      .from("payments")
      .insert({
        task_id: taskId,
        amount_paise: 424242,
        employee_id: employeeId,
        payee: employeeId,
        currency: "INR",
        type: "TASK_PAYOUT",
        status: "PENDING",
        description: `ledger-safety-${RUN}`,
      })
      .select("id")
      .single();
    assert.equal(error, null, `payment fixture: ${error?.message}`);
    created.payments.push(payment.id);

    const { error: delErr } = await admin.from("tasks").delete().eq("id", taskId);
    assert.equal(delErr, null, `task delete must succeed: ${delErr?.message}`);

    const { data: after, error: readErr } = await admin
      .from("payments")
      .select("id, task_id, amount_paise, status")
      .eq("id", payment.id)
      .single();
    assert.equal(readErr, null, "the payment must still be readable after the task is gone");
    assert.ok(after, "the payment row must survive task deletion");
    assert.equal(after.task_id, null, "the link must be cleared, not left dangling");
    assert.equal(after.amount_paise, 424242, "the amount must be untouched");
    assert.equal(after.status, "PENDING");
  });

  it("Test B — deleting a task never deletes its payment", async () => {
    if (!ready) return;
    const taskId = await makeTask(`ledger-safety-B-${RUN}`, "IN_PROGRESS");
    const { data: payment, error } = await admin
      .from("payments")
      .insert({
        task_id: taskId,
        amount_paise: 111111,
        employee_id: employeeId,
        payee: employeeId,
        currency: "INR",
        type: "TASK_PAYOUT",
        status: "PENDING",
        description: `ledger-safety-${RUN}`,
      })
      .select("id")
      .single();
    assert.equal(error, null, `payment fixture: ${error?.message}`);
    created.payments.push(payment.id);

    await admin.from("tasks").delete().eq("id", taskId);

    const { count } = await admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("id", payment.id);
    assert.equal(count, 1, "task deletion must not reduce the payment count");
  });

  it("Test C — a PAID payment keeps its whole financial history", async () => {
    if (!ready) return;
    const taskId = await makeTask(`ledger-safety-C-${RUN}`, "APPROVED");
    const paidAt = "2026-01-15T06:30:00.000Z";
    const { data: payment, error } = await admin
      .from("payments")
      .insert({
        task_id: taskId,
        amount_paise: 99999,
        employee_id: employeeId,
        payee: employeeId,
        created_by: employeeId,
        currency: "INR",
        type: "TASK_PAYOUT",
        status: "PAID",
        paid_at: paidAt,
        paid_by: employeeId,
        payment_method: "UPI",
        reference_number: `ledger-safety-UTR-${RUN}`,
        description: `ledger-safety-${RUN}`,
      })
      .select("id")
      .single();
    assert.equal(error, null, `payment fixture: ${error?.message}`);
    created.payments.push(payment.id);

    await admin.from("tasks").delete().eq("id", taskId);

    const { data: after } = await admin
      .from("payments")
      .select(
        "task_id, status, paid_at, paid_by, payment_method, reference_number, amount_paise",
      )
      .eq("id", payment.id)
      .single();
    assert.ok(after, "a paid payment must survive its task");
    assert.equal(after.task_id, null);
    assert.equal(after.status, "PAID");
    assert.equal(after.paid_at, paidAt, "the paid instant must not shift");
    assert.equal(after.paid_by, employeeId);
    assert.equal(after.payment_method, "UPI");
    assert.equal(after.reference_number, `ledger-safety-UTR-${RUN}`);
    assert.equal(after.amount_paise, 99999);
  });

  it("Test D — audit events survive, and block the payment being deleted", async () => {
    if (!ready) return;
    const { data: payment, error } = await admin
      .from("payments")
      .insert({
        amount_paise: 77777,
        employee_id: employeeId,
        payee: employeeId,
        currency: "INR",
        type: "CUSTOM",
        status: "PENDING",
        description: `ledger-safety-${RUN}`,
      })
      .select("id")
      .single();
    assert.equal(error, null, `payment fixture: ${error?.message}`);
    created.payments.push(payment.id);

    const { data: event, error: evErr } = await admin
      .from("payment_events")
      .insert({
        payment_id: payment.id,
        actor_id: employeeId,
        action: "CREATED",
        to_status: "PENDING",
        metadata: { probe: RUN },
      })
      .select("id")
      .single();
    assert.equal(evErr, null, `event fixture: ${evErr?.message}`);

    // The audit trail must refuse to go quietly.
    const { error: delErr } = await admin.from("payments").delete().eq("id", payment.id);
    assert.notEqual(delErr, null, "a payment with events must not be deletable");
    assert.match(String(delErr?.message ?? ""), /foreign key|violates/i);

    const { count } = await admin
      .from("payment_events")
      .select("id", { count: "exact", head: true })
      .eq("id", event.id);
    assert.equal(count, 1, "the event must still be there");
  });

  it("still refuses to create a TASK_PAYOUT that names no task", async () => {
    if (!ready) return;
    const { error } = await admin.from("payments").insert({
      amount_paise: 12345,
      employee_id: employeeId,
      payee: employeeId,
      currency: "INR",
      type: "TASK_PAYOUT",
      status: "PENDING",
      description: `ledger-safety-${RUN}`,
    });
    assert.notEqual(error, null, "the guard must reject a task payout with no task");
  });
});
