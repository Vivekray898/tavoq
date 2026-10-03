// Verifies the LIVE Supabase project against the role-migration end state.
//
// The post-OAuth redirect loop had four candidate causes; three of them
// live in the database rather than in code:
//   1. user_role still contains the legacy 'ADMIN' label
//   2. profiles.role is NULL on some row (a half-applied migration)
//   3. a row is left non-ACTIVE, so is_active_user() denies it
//   4. the `active` flag has drifted from status
//
// All four are data/enum state, so no amount of reading the source can
// clear them — they have to be read from the running database. This
// script does that, and is deliberately runnable on demand rather than
// in `npm test`, because it needs SUPABASE_SERVICE_ROLE_KEY and network
// access to the real project.
//
//   node scripts/verify-profile-role-integrity.mjs
//   npm run verify:db
//
// Requires SUPABASE_SERVICE_ROLE_KEY (server-side only; never the anon
// key) plus NEXT_PUBLIC_SUPABASE_URL. Exits 1 on any failure so it can
// gate a deploy or be pasted into CI.
//
// How it checks the enum without a SQL connection
// ------------------------------------------------
// There is no `pg` dependency and no DB password in .env.local, so the
// script cannot run `SELECT enum_range(NULL::user_role)`. It uses two
// independent PostgREST signals instead:
//
//   (a) the OpenAPI schema, which PostgREST generates from the live
//       catalog and which publishes the enum labels verbatim. This is
//       EXHAUSTIVE: it catches a stray extra value, which is more than
//       a membership probe could.
//   (b) a membership probe per expected value, as a cross-check. A value
//       that is not in the enum makes Postgres reject the filter with
//       22P02 "invalid input value for enum user_role", so a 200 proves
//       the label is genuinely a member of the type — not merely listed
//       in a schema document.
//
// The `active` invariant is not hard-coded from a guess: migration 008
// maintains `active = (status = 'ACTIVE')` in a BEFORE trigger, so that
// is exactly what this asserts.

import { readFileSync } from "node:fs";

const EXPECTED_ROLES = ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"];
const EXPECTED_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED"];
/** Roles that are only ever correct pre-migration. */
const LEGACY_ROLES = ["ADMIN"];
/** Optional: pin one account's expected state. TAVoq_EXPECT_EMAIL + TAVoq_EXPECT_ROLE. */
const PIN_EMAIL = process.env.TAVoq_EXPECT_EMAIL ?? "moddriod.co@gmail.com";
const PIN_ROLE = process.env.TAVoq_EXPECT_ROLE ?? "SUPER_ADMIN";

function loadEnvFile(path = ".env.local") {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // the environment may already provide these
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue; // real env wins
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["'](.*)["']$/, "$1");
  }
}

loadEnvFile();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "FAIL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n" +
      "      This check reads the live project and must use the service-role key;\n" +
      "      the anon key cannot see enough of profiles to verify this.",
  );
  process.exit(1);
}
// Guard against being handed the browser-safe key. Supabase ships two
// formats: legacy JWTs (where the payload claims `role: service_role`)
// and the current `sb_secret_...` / `sb_publishable_...` pair. Accept
// either shape, and reject anything that is the publishable/anon key.
const isServiceRoleKey = (k) => {
  if (k === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return false;
  if (k.startsWith("sb_secret_")) return true;
  const parts = k.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
};

if (!isServiceRoleKey(key)) {
  console.error(
    "FAIL: SUPABASE_SERVICE_ROLE_KEY is missing, or is the anon/publishable key.\n" +
      "      This check reads rows RLS hides from normal users, so it needs a\n" +
      "      service-role key — which must never be committed or shipped to the browser.",
  );
  process.exit(1);
}

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`ok   ${msg}`);

const rest = async (path, { accept } = {}) => {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(accept ? { Accept: accept } : {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
};

// ── 1. the enum, exhaustively, from the live catalog ──────────────────
console.log("user_role enum (from the live PostgREST schema)\n");

const spec = await rest("", { accept: "application/openapi+json" });
if (spec.status !== 200) {
  fail(`could not read the PostgREST schema (HTTP ${spec.status})`);
} else {
  const defs = spec.body?.definitions ?? spec.body?.components?.schemas ?? {};
  const enumOf = (table, prop) => defs[table]?.properties?.[prop]?.enum;

  const live = enumOf("profiles", "role");
  if (!Array.isArray(live)) {
    fail("profiles.role has no enum in the schema — cannot verify the type");
  } else {
    const missing = EXPECTED_ROLES.filter((r) => !live.includes(r));
    const legacy = LEGACY_ROLES.filter((r) => live.includes(r));
    const extra = live.filter((r) => !EXPECTED_ROLES.includes(r));

    if (missing.length) fail(`user_role is missing ${missing.join(", ")}`);
    if (legacy.length) fail(`user_role still contains legacy ${legacy.join(", ")} — migration 013's RENAME did not run`);
    if (extra.length) fail(`user_role has unexpected extra value(s): ${extra.join(", ")}`);
    if (!missing.length && !legacy.length && !extra.length) {
      ok(`user_role = [${live.join(", ")}] (exactly the expected three, in no particular order)`);
    }

    // Same enum, other dependent columns — a partial migration can leave
    // these disagreeing with profiles.role.
    for (const [table, prop] of [
      ["invitations", "role"],
      ["admin_audit_log", "previous_role"],
      ["admin_audit_log", "next_role"],
    ]) {
      const other = enumOf(table, prop);
      if (Array.isArray(other)) {
        const drift = other.filter((r) => !EXPECTED_ROLES.includes(r));
        if (drift.length) {
          fail(`${table}.${prop} disagrees with user_role: ${drift.join(", ")}`);
        } else {
          ok(`${table}.${prop} matches user_role`);
        }
      }
    }

    const liveStatuses = enumOf("profiles", "status");
    if (Array.isArray(liveStatuses)) {
      const bad = liveStatuses.filter((s) => !EXPECTED_STATUSES.includes(s));
      if (bad.length) fail(`profiles.status has unexpected value(s): ${bad.join(", ")}`);
      else ok(`profiles.status = [${liveStatuses.join(", ")}]`);
    }
  }
}

// ── 2. cross-check by probe: a non-member label must be rejected ─────
console.log("\nenum membership probe (a non-member is rejected with 22P02)\n");
for (const value of [...EXPECTED_ROLES, ...LEGACY_ROLES]) {
  const { status, body } = await rest(
    `profiles?select=id&role=eq.${encodeURIComponent(value)}&limit=1`
  );
  const message = typeof body === "object" ? body?.message : "";
  if (status === 200) {
    if (LEGACY_ROLES.includes(value)) {
      fail(`'${value}' was accepted by the database but must not exist any more`);
    } else {
      ok(`'${value}' is a member of user_role`);
    }
  } else if (/invalid input value for enum user_role/.test(message ?? "")) {
    if (LEGACY_ROLES.includes(value)) {
      ok(`'${value}' is correctly absent (22P02)`);
    } else {
      fail(`'${value}' is NOT a member of user_role — migration 013 did not commit: ${message}`);
    }
  } else {
    // Anything else is a real problem: a probe we cannot interpret is not
    // a pass, and is never swallowed.
    fail(`probe for '${value}' was inconclusive (HTTP ${status}): ${message ?? "(no message)"}`);
  }
}

// ── 3. the data itself ───────────────────────────────────────────────
console.log("\nprofiles rows\n");

const rowsRes = await rest("profiles?select=id,email,role,status,active");
if (rowsRes.status !== 200) {
  fail(`could not read profiles (HTTP ${rowsRes.status})`);
} else {
  const rows = Array.isArray(rowsRes.body) ? rowsRes.body : [];
  const emails = (r) => (r.email ?? r.id).toString();

  if (rows.length === 0) {
    fail("no profiles rows at all — nothing to verify");
  } else {
    const nullRole = rows.filter((r) => r.role == null);
    const legacy = rows.filter((r) => LEGACY_ROLES.includes(r.role));
    // Trigger-maintained by migration 008: active = (status = 'ACTIVE').
    const drifted = rows.filter((r) => r.active !== (r.status === "ACTIVE"));
    const unknownRole = rows.filter((r) => r.role != null && !EXPECTED_ROLES.includes(r.role));
    const unknownStatus = rows.filter((r) => r.status != null && !EXPECTED_STATUSES.includes(r.status));

    if (legacy.length) {
      fail(
        `${legacy.length} row(s) still hold a legacy role: ${legacy.map(emails).join(", ")}`,
      );
    } else ok("no row holds a legacy role");

    if (nullRole.length) {
      // Not fatal on its own — a PENDING signup legitimately has no role
      // until an admin approves it — but it must not also be ACTIVE.
      const bad = nullRole.filter((r) => r.status === "ACTIVE");
      if (bad.length) {
        fail(
          `${bad.length} ACTIVE row(s) have no role: ${bad.map(emails).join(", ")} — ` +
            "these are denied by is_active_user() and land on /pending",
        );
      } else {
        ok(`${nullRole.length} row(s) have no role, all non-ACTIVE (expected for unapproved signups)`);
      }
    } else ok("every row has a role");

    if (unknownRole.length) fail(`unexpected role value(s): ${unknownRole.map(emails).join(", ")}`);
    if (unknownStatus.length) fail(`unexpected status value(s): ${unknownStatus.map(emails).join(", ")}`);

    if (drifted.length) {
      fail(
        `active flag disagrees with status on: ${drifted
          .map((r) => `${emails(r)} (status=${r.status}, active=${r.active})`)
          .join(", ")} — migration 008's trigger was bypassed`,
      );
    } else ok("active flag agrees with status on every row");

    const byState = new Map();
    for (const r of rows) {
      const k = `${r.role ?? "(no role)"}/${r.status}`;
      byState.set(k, (byState.get(k) ?? 0) + 1);
    }
    console.log(
      `     ${rows.length} row(s): ` +
        [...byState.entries()].sort().map(([k, v]) => `${k} x${v}`).join(", "),
    );
  }
}

// ── 4. the account that was reported as unable to sign in ────────────
console.log(`\npinned account ${PIN_EMAIL}\n`);
const pin = await rest(
  `profiles?select=id,role,status,active,approved_at&email=eq.${encodeURIComponent(PIN_EMAIL)}&limit=1`,
);
if (pin.status !== 200) {
  fail(`could not read the pinned account (HTTP ${pin.status})`);
} else if (!Array.isArray(pin.body) || pin.body.length === 0) {
  fail(`${PIN_EMAIL} has no profiles row — this is the "no profile found" case`);
} else {
  const p = pin.body[0];
  if (p.role !== PIN_ROLE) fail(`${PIN_EMAIL} has role ${p.role}, expected ${PIN_ROLE}`);
  else ok(`role = ${p.role}`);
  if (p.status !== "ACTIVE") fail(`${PIN_EMAIL} has status ${p.status}, expected ACTIVE`);
  else ok(`status = ACTIVE`);
  if (p.active !== true) fail(`${PIN_EMAIL} has active = ${p.active}, expected true`);
  else ok(`active = true`);
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"}: live user_role enum and profiles integrity`,
);
if (failures > 0) process.exit(1);
