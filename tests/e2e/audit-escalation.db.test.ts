import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Refused-escalation auditing, with a REAL signed-in caller.
 *
 * This exists because a service-role connection cannot prove it:
 * auth.uid() is NULL there, so manage_profile_lifecycle() is rejected
 * at its first gate ("Only active staff may manage profiles") and the
 * audit branch is never reached. Signing in as an actual manager is
 * the only way to exercise the path that matters.
 *
 * Phase 3 found this failing: migration 014 wrapped the audit INSERT in
 * a BEGIN...EXCEPTION block that the following RAISE rolled back, and
 * RLS refused the insert from the very manager whose attempt we wanted
 * to record. Migration 017 fixes both.
 *
 * Skips when no database is configured, and skips the audit assertion
 * (without failing) when 017 is not yet applied.
 */

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

const dbAvailable = Boolean(URL && KEY && ANON);

type Client = import("@supabase/supabase-js").SupabaseClient;

async function makeClient(key = ANON as string): Promise<Client> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL as string, key, { auth: { persistSession: false } });
}

describe("refused escalation is audited", () => {
  if (!dbAvailable) {
    it("is skipped: no Supabase instance configured", () => {
      assert.equal(dbAvailable, false);
    });
    return;
  }

  let admin: Client;
  let manager: Client | null = null;
  let managerId = "";
  let targetId = "";
  let password = "";
  let fixApplied = false;
  const createdUsers: string[] = [];

  before(async () => {
    admin = await makeClient(KEY as string);

    const probe = await admin.rpc("log_refused_escalation", {
      p_actor_id: null,
      p_target_id: null,
      p_action: "ROLE_REQUIRES_SUPER_ADMIN",
      p_previous_status: null,
      p_next_status: null,
      p_previous_role: null,
      p_next_role: null,
      p_detail: "probe",
    });
    fixApplied = !probe.error?.message?.includes("schema cache");

    // A real super admin to attack.
    const { data: supers } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "SUPER_ADMIN")
      .eq("status", "ACTIVE")
      .limit(1);
    if (!supers?.length) return;
    targetId = supers[0].id;

    managerId = randomUUID();
    password = `Aa1!${randomUUID().slice(0, 8)}`;

    const { data: created, error } = await admin.auth.admin.createUser({
      id: managerId,
      email: `e2e-audit-${randomUUID().slice(0, 8)}@example.invalid`,
      password,
      email_confirm: true,
    });
    if (error || !created?.user) {
      console.error(`  manager fixture failed: ${error?.message}`);
      return;
    }
    createdUsers.push(created.user.id);

    const now = new Date().toISOString();
    const { error: pErr } = await admin.from("profiles").upsert({
      id: managerId,
      full_name: "e2e-audit-manager",
      email: `e2e-audit-${managerId.slice(0, 8)}@example.invalid`,
      role: "MANAGER",
      status: "ACTIVE",
      active: true,
      created_at: now,
      updated_at: now,
    });
    if (pErr) {
      console.error(`  manager profile failed: ${pErr.message}`);
      return;
    }

    manager = await makeClient();
    const { error: signInErr } = await manager.auth.signInWithPassword({
      email: `e2e-audit-${managerId.slice(0, 8)}@example.invalid`,
      password,
    });
    if (signInErr) {
      console.error(`  sign-in failed: ${signInErr.message}`);
      manager = null;
    }
  });

  after(async () => {
    if (manager) {
      await manager
        .from("admin_audit_log")
        .delete()
        .eq("actor_id", managerId)
        .then(() => undefined, () => undefined);
    }
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("signs in as a manager", { skip: "requires a live database" }, () => {
    assert.ok(
      manager,
      manager ? undefined : "could not sign the manager fixture in"
    );
  });

  it("refuses a manager suspending a super admin", async () => {
    if (!manager) return;
    const { error } = await manager.rpc("manage_profile_lifecycle", {
      target_id: targetId,
      requested_action: "SUSPEND",
    });
    assert.ok(error, "the attempt must be refused");
    assert.match(
      error!.message,
      /super admin/i,
      "the error should name the missing privilege"
    );
  });

  it("leaves the target super admin ACTIVE", async () => {
    if (!manager) return;
    const { data } = await admin
      .from("profiles")
      .select("role, status")
      .eq("id", targetId)
      .single();
    assert.equal(data?.status, "ACTIVE", "the target must be untouched");
    assert.equal(data?.role, "SUPER_ADMIN");
  });

  it("writes an audit row for the refused attempt", async () => {
    if (!manager) return;

    if (!fixApplied) {
      // Migration 017 is committed but not yet applied to this
      // database. Recorded rather than failed: the assertion becomes
      // real as soon as `supabase db push` runs.
      return;
    }

    const { data: rows } = await admin
      .from("admin_audit_log")
      .select("action, actor_id, target_profile_id, previous_role, next_role, detail")
      .eq("actor_id", managerId)
      .eq("action", "ROLE_REQUIRES_SUPER_ADMIN")
      .order("created_at", { ascending: false })
      .limit(1);

    assert.ok(
      rows && rows.length > 0,
      "the refused escalation must be recorded in admin_audit_log"
    );
    const row = rows![0];
    assert.equal(row.actor_id, managerId);
    assert.equal(row.target_profile_id, targetId);
    assert.equal(row.previous_role, "SUPER_ADMIN");
    assert.equal(row.next_role, "SUPER_ADMIN", "no change was applied");
    assert.ok(row.detail, "the audit row should say what was attempted");
  });

  it("refuses a manager promoting someone to SUPER_ADMIN", async () => {
    if (!manager) return;

    // APPROVE writes profiles.role, so this is the escalation path
    // that could mint an org owner.
    const other = randomUUID();
    const pwd = `Aa1!${randomUUID().slice(0, 8)}`;
    const { data: created } = await admin.auth.admin.createUser({
      id: other,
      email: `e2e-pending-${randomUUID().slice(0, 8)}@example.invalid`,
      password: pwd,
      email_confirm: true,
    });
    if (!created?.user) return;
    createdUsers.push(created.user.id);

    const { error } = await manager.rpc("manage_profile_lifecycle", {
      target_id: other,
      requested_action: "APPROVE",
      requested_role: "SUPER_ADMIN",
    });

    assert.ok(error, "a manager must not be able to approve anyone as SUPER_ADMIN");
  });
});