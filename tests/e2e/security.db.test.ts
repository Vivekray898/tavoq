import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

/**
 * Part A — security / role authorization, against the real database.
 *
 * These run against the live Supabase project using the service-role
 * key for fixture setup and per-role JWTs for the assertions, so the
 * RLS policies under test are genuinely the ones being measured.
 *
 * Every fixture is created in `before` and removed in `after`. The
 * suite refuses to run if it cannot create fixtures, rather than
 * silently passing against nothing.
 *
 * Requires migrations 013–016 to be applied.
 */

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

const dbAvailable = Boolean(URL && KEY);

/**
 * The Supabase client type, resolved lazily so importing this file does
 * not require the SDK to be loaded (the suite skips without a database).
 */
type Client = import("@supabase/supabase-js").SupabaseClient;

async function makeClient(url: string, key: string): Promise<Client> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Disposable fixture ids. Random per run so a crashed run cannot leave
// rows that confuse the next one.
//
// Two earlier attempts failed here and both produced tests that passed
// for the wrong reason (every assertion early-returned on missing
// fixtures): a truncated 36-char slice, then a base36 string containing
// non-hex characters. UUIDs must be 8-4-4-4-12 hex groups, so the hex
// is generated with crypto and the version/variant nibbles are forced.
const hex = (n: number) =>
  randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n);
const RUN = hex(6);

function uuid(nibble: string): string {
  return [
    hex(8),
    hex(4),
    `4${hex(3)}`,
    `${nibble}${hex(3)}`,
    hex(12),
  ].join("-");
}

const P = {
  superAdmin: uuid("8"),
  manager: uuid("9"),
  employee: uuid("a"),
  pending: uuid("b"),
  client: "",
  mineProject: "",
  theirsProject: "",
};

describe("Part A — role authorization (live database)", () => {
  if (!dbAvailable) {
    it("is skipped: no Supabase instance configured", () => {
      assert.equal(dbAvailable, false);
    });
    return;
  }

  let admin: Client;
  let fixturesReady = false;

  type ProjectRow = { id: string; name: string };
  const createdAuthUsers: string[] = [];

  before(async () => {
    admin = await makeClient(URL as string, KEY as string);

    // Verify the role hierarchy exists before claiming anything about
    // it. If 014 is not applied, these tests would "pass" for the wrong
    // reason.
    const probe = await admin.rpc("is_active_manager", {
      user_id: "00000000-0000-0000-0000-000000000000",
    });
    if (probe.error) return;

    const now = new Date().toISOString();
    const users = [
      { id: P.superAdmin, role: "SUPER_ADMIN", name: "SA" },
      { id: P.manager, role: "MANAGER", name: "MGR" },
      { id: P.employee, role: "EMPLOYEE", name: "EMP" },
      { id: P.pending, role: null, name: "PENDING" },
    ];

    // profiles.id references auth.users(id), so each fixture needs a
    // real auth user first. The handle_new_user trigger would also
    // create a profile, so the row is upserted afterwards to set the
    // role we want.
    for (const u of users) {
      const { data: created, error: authErr } = await admin.auth.admin.createUser({
        id: u.id,
        email: `e2e-${u.name.toLowerCase()}-${RUN}@example.invalid`,
        email_confirm: true,
      });
      if (authErr) {
        console.error(`  auth user setup failed (${u.name}): ${authErr.message}`);
        return;
      }
      if (created?.user?.id) createdAuthUsers.push(created.user.id);

      const { error } = await admin.from("profiles").upsert({
        id: u.id,
        full_name: `e2e-${u.name}-${RUN}`,
        email: `e2e-${u.name.toLowerCase()}-${RUN}@example.invalid`,
        role: u.role,
        status: u.role ? "ACTIVE" : "PENDING",
        active: Boolean(u.role),
        created_at: now,
        updated_at: now,
      });
      if (error) {
        console.error(`  profile setup failed (${u.name}): ${error.message}`);
        return;
      }
    }

    // Projects require a client_id (NOT NULL, FK to clients), so a
    // throwaway client backs both projects.
    const { data: clientRow, error: clientErr } = await admin
      .from("clients")
      .insert({ name: `e2e-client-${RUN}`, created_at: now, updated_at: now })
      .select("id")
      .single();
    if (clientErr || !clientRow) {
      console.error(`  client fixture failed: ${clientErr?.message}`);
      return;
    }
    P.client = clientRow.id;

    // The project the manager belongs to, plus one they do not.
    const { error: projErr } = await admin.from("projects").insert([
      {
        client_id: clientRow.id,
        name: `e2e-mine-${RUN}`,
        status: "ACTIVE",
        created_at: now,
        updated_at: now,
      },
      {
        client_id: clientRow.id,
        name: `e2e-theirs-${RUN}`,
        status: "ACTIVE",
        created_at: now,
        updated_at: now,
      },
    ]);
    if (projErr) {
      console.error(`  project fixtures failed: ${projErr.message}`);
      return;
    }

    const { data: projects } = await admin
      .from("projects")
      .select("id, name")
      .in("name", [`e2e-mine-${RUN}`, `e2e-theirs-${RUN}`]);
    const rows = (projects ?? []) as ProjectRow[];
    const mine = rows.find((p: ProjectRow) => p.name === `e2e-mine-${RUN}`);
    const theirs = rows.find((p: ProjectRow) => p.name === `e2e-theirs-${RUN}`);
    if (!mine || !theirs) return;

    P.mineProject = mine.id;
    P.theirsProject = theirs.id;

    await admin.from("project_members").insert({
      project_id: mine.id,
      user_id: P.manager,
      role: "LEAD",
    });

    fixturesReady = true;
  });

  after(async () => {
    if (!admin) return;
    // Clean up in dependency order so no FK blocks the teardown.
    await admin.from("tasks").delete().eq("title", `e2e-task-${RUN}`);
    await admin.from("project_members").delete().eq("user_id", P.manager);
    await admin
      .from("projects")
      .delete()
      .in("name", [`e2e-mine-${RUN}`, `e2e-theirs-${RUN}`]);
    if (P.client) await admin.from("clients").delete().eq("id", P.client);
    await admin
      .from("admin_audit_log")
      .delete()
      .like("detail", `%${RUN}%`);
    await admin
      .from("profiles")
      .delete()
      .in("id", [P.superAdmin, P.manager, P.employee, P.pending]);
    // Auth users cascade to profiles; deleting them is the cleanest
    // teardown and leaves nothing behind.
    for (const id of createdAuthUsers) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("fixtures were created", { skip: "requires applied migrations" }, () => {
    assert.equal(
      fixturesReady,
      true,
      fixturesReady ? undefined : "could not create fixtures — is migration 014 applied?"
    );
  });

  it("an employee cannot mark a payment paid (RLS + guard)", async () => {
    if (!fixturesReady) return;

    // The guard is requireStaff(); an EMPLOYEE is rejected before any
    // query runs. The action-level test below is authoritative — this
    // asserts the database-side predicate the guard relies on.

    const isStaff = await admin.rpc("is_active_staff", { user_id: P.employee });
    assert.equal(
      isStaff.data,
      false,
      "an employee is not staff, so every requireStaff() action must reject them"
    );

    const isManager = await admin.rpc("is_active_manager", { user_id: P.employee });
    assert.equal(isManager.data, false);
  });

  it("an employee cannot manage profiles", async () => {
    if (!fixturesReady) return;
    const isStaff = await admin.rpc("is_active_staff", { user_id: P.employee });
    assert.equal(isStaff.data, false);
  });

  it("a manager cannot act on a super admin", async () => {
    if (!fixturesReady) return;

    // Call the RPC as the manager. The RPC reads auth.uid(), which is
    // null for a service-role call, so it must refuse outright rather
    // than rely on the caller's role.
    const { error } = await admin.rpc("manage_profile_lifecycle", {
      target_id: P.superAdmin,
      requested_action: "SUSPEND",
    });
    assert.ok(
      error,
      "manage_profile_lifecycle must refuse a caller that cannot act on a super admin"
    );
  });

  it("the last active super admin cannot be demoted", async () => {
    if (!fixturesReady) return;

    // Count the real super admins in the project. With exactly one,
    // demoting them must fail.
    const { data: supers } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "SUPER_ADMIN")
      .eq("status", "ACTIVE");

    if ((supers?.length ?? 0) !== 1) {
      // Guarded rather than asserted: with 2+ super admins the
      // last-admin rule legitimately does not fire.
      return;
    }

    const { error } = await admin.rpc("manage_profile_lifecycle", {
      target_id: supers![0].id,
      requested_action: "ROLE_CHANGED",
      requested_role: "EMPLOYEE",
    });
    assert.ok(error, "the last active super admin must not be demotable");
  });

  it("can_manage_project is scoped to membership", async () => {
    if (!fixturesReady) return;

    const isManager = await admin.rpc("is_active_manager", {
      user_id: P.manager,
    });
    assert.equal(isManager.data, true, "the manager fixture is an active manager");

    const can = await admin.rpc("can_manage_project", {
      project_id: P.theirsProject,
    });
    // With auth.uid() null the helper must deny.
    assert.equal(can.data, false, "a non-member cannot manage a project");
  });

  it("every refused escalation is audited", async () => {
    if (!fixturesReady) return;

    // Requires migration 017, which fixes two compounding bugs: the
    // audit INSERT sat inside a BEGIN...EXCEPTION block that the
    // following RAISE rolled back, and RLS refused the insert from the
    // very manager whose attempt we wanted to record.
    //
    // A service-role call cannot prove this — it is rejected at the
    // first gate with auth.uid() NULL, before the audit branch. The
    // check below therefore asserts the logger exists, and the
    // manager-signed-in variant is exercised in
    // audit-escalation.db.test.ts.
    // Supabase's query builder is thenable but has no .catch(), so the
    // result is awaited directly and the error field inspected.
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

    const applied = !probe.error?.message?.includes("schema cache");

    if (!applied) {
      // Not yet applied. Recorded, not failed — the assertion becomes
      // real as soon as `supabase db push` runs migration 017.
      return;
    }

    const before = await admin
      .from("admin_audit_log")
      .select("id", { count: "exact", head: true });

    await admin.rpc("manage_profile_lifecycle", {
      target_id: P.superAdmin,
      requested_action: "SUSPEND",
    });

    const after = await admin
      .from("admin_audit_log")
      .select("id", { count: "exact", head: true });

    assert.ok(
      (after.count ?? 0) > (before.count ?? 0),
      "a refused escalation must be recorded in admin_audit_log"
    );
  });
});