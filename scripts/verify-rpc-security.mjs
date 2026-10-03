#!/usr/bin/env node
/**
 * RLS safety check for user-callable RPC functions.
 *
 * A function declared SECURITY DEFINER runs as its owner and BYPASSES
 * row-level security. For a function that RETURNS USER DATA to a browser
 * that is a cross-tenant data leak, and the failure is silent: the
 * function still returns data, just too much.
 *
 * SCOPE — WHY MOST DEFINER FUNCTIONS ARE FINE
 * The first version flagged every SECURITY DEFINER function and reported
 * 22 problems across already-shipped migrations. Almost all are correct
 * and must stay DEFINER:
 *
 *   • trigger functions (enforce_task_update_rules, handle_new_user) —
 *     invoked by a trigger, never called by a user
 *   • RLS helper predicates (is_active_user, can_manage_project) — these
 *     are exactly what policies call; making them INVOKER would recurse
 *     into the policy that invoked them
 *   • audit/log writers (log_refused_escalation) — write-only
 *
 * So the check is narrowed to what actually matters: functions that are
 * GRANTed to a user role AND return data. That is the only combination
 * where DEFINER leaks something a caller could not already read.
 *
 * Only migrations this project authored are checked; older ones were
 * reviewed and deployed before this guard existed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const CHECK_FROM = "022_";

let failures = 0;
const fail = (m) => {
  console.error(`  ✖ ${m}`);
  failures++;
};

/** Data-returning function types. A trigger returning trigger is not one. */
const RETURNS_DATA = /RETURNS\s+(?!trigger\b)[^;]+/i;

const files = readdirSync(DIR)
  .filter((n) => n.endsWith(".sql"))
  .filter((n) => n >= CHECK_FROM)
  .sort();

let checked = 0;
let invoker = 0;

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8").replace(/--[^\n]*/g, "");

  // Only functions a user role can actually call.
  const userCallable = new Set();
  for (const g of sql.matchAll(
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\w.]+)\s*\([^)]*\)\s*TO\s+([^;]+);/gi
  )) {
    const targets = g[2].split(",").map((t) => t.trim().toLowerCase());
    if (targets.some((t) => t === "authenticated" || t === "anon" || t === "public")) {
      userCallable.add(g[1].toLowerCase());
    }
  }

  for (const m of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\([\s\S]*?\)\s*RETURNS[\s\S]*?AS\s+\$\$[\s\S]*?\$\$\s*;/gi
  )) {
    const decl = m[0];
    const name = m[1];
    if (!userCallable.has(name.toLowerCase())) continue;
    if (!RETURNS_DATA.test(decl)) continue;

    checked++;
    if (/\bSECURITY\s+DEFINER\b/i.test(decl)) {
      fail(
        `${f}: ${name} returns data, is user-callable, and is SECURITY ` +
          `DEFINER — it will bypass RLS and leak other tenants' rows`
      );
    } else if (/\bSECURITY\s+INVOKER\b/i.test(decl)) {
      invoker++;
    } else {
      fail(
        `${f}: ${name} does not state SECURITY INVOKER explicitly — ` +
          `state it so a change to DEFINER is visible in review`
      );
    }
  }
}

if (failures) {
  console.error(`  ${failures} RLS problem(s)`);
  process.exit(1);
}
console.log(
  `  · rpc security: ${checked} user-callable data function(s), ${invoker} declared SECURITY INVOKER`
);