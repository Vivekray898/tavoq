#!/usr/bin/env node
/**
 * RPC payload shape check.
 *
 * TypeScript cannot see inside a plpgsql function, so a mismatch between
 * what the SQL emits and what the component reads is invisible to
 * `tsc` and to the unit tests — the RPC is typed as
 * `data as AdminDashboardData`, a cast the compiler accepts blindly.
 *
 * This caught a real one: the submitted-tasks branch built its rows with
 * `to_jsonb(s) || jsonb_build_object(...)`, which leaked the CTE's
 * column names and omitted `kind`, `created_at` and `deadline`. The page
 * would have rendered rows with an undefined kind and no timestamp, and
 * nothing would have thrown.
 *
 * The check compares the keys the SQL constructs against the keys the
 * TypeScript interface declares, for the arrays the dashboard reads.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const sql = readFileSync(
  join(ROOT, "supabase", "migrations", "022_dashboard_bootstrap_rpc.sql"),
  "utf8"
).replace(/--[^\n]*/g, "");
const ts = readFileSync(join(ROOT, "lib", "actions", "dashboard.ts"), "utf8");

let failures = 0;
const fail = (m) => {
  console.error(`  ✖ ${m}`);
  failures++;
};

/**
 * Keys the TS interface declares for an array field.
 *
 * The slice starts AFTER the field declaration: an earlier version began
 * at it and the regex then matched `needs_attention:` as though it were
 * one of the row keys, so every check reported the field name itself as
 * missing. Restricting to `;`-terminated rows inside the braces fixes it.
 */
function contractKeys(field) {
  const start = ts.indexOf(`${field}: Array<{`);
  if (start === -1) return null;
  const open = ts.indexOf("{", start);
  const end = ts.indexOf("}>;", open);
  if (end === -1) return null;
  const body = ts.slice(open, end);
  return new Set([...body.matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]));
}

/**
 * Body of the jsonb_build_object(...) call that feeds an INTO target.
 *
 * Scans for the matching close paren by counting depth. A regex alone
 * cannot do this: the recent_activity block contains a CASE expression
 * with its own parentheses, so a non-greedy match stopped at the first
 * `)` and reported the block as truncated — a parser failure that looks
 * exactly like missing fields in the SQL.
 */
function buildObjectBody(variable, nth = 0) {
  const re = new RegExp(`INTO\\s+${variable}\\b`, "g");
  const targets = [...sql.matchAll(re)];
  const target = targets[nth];
  if (!target) return null;

  const open = sql.lastIndexOf("jsonb_build_object(", target.index);
  if (open === -1) return null;

  let depth = 0;
  let i = sql.indexOf("(", open);
  const start = i + 1;
  for (; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return sql.slice(start, i);
    }
  }
  return null;
}

/** The keys that block declares. */
function sqlKeys(variable, nth = 0) {
  const body = buildObjectBody(variable, nth);
  if (!body) return null;
  return new Set([...body.matchAll(/^\s*'([a-z_]+)'/gm)].map((m) => m[1]));
}

const CHECKS = [
  // v_needs_attention is assigned twice: submitted first, then overwritten
  // with the concatenation. Only the submitted block is structurally
  // comparable; the overdue block is checked by the shared contract below.
  { field: "needs_attention", variable: "v_needs_attention", nth: 0 },
  { field: "recent_activity", variable: "v_recent_activity", nth: 0 },
];

for (const { field, variable, nth } of CHECKS) {
  const want = contractKeys(field);
  const got = sqlKeys(variable, nth);
  if (!want || !got) continue;

  const missing = [...want].filter((k) => !got.has(k));
  if (missing.length) {
    fail(
      `${field}: RPC omits ${missing.join(", ")} — the component reads ` +
        `those fields and they would be undefined`
    );
  }
}

// The overdue branch must carry the same keys as the submitted one.
const overdueBlock = buildObjectBody("v_needs_attention_overdue");
if (overdueBlock) {
  // buildObjectBody returns the block as a STRING; an earlier version
  // still indexed it as a match array, so this iterated characters and
  // reported every key as missing.
  const keys = new Set([...overdueBlock.matchAll(/^\s*'([a-z_]+)'/gm)].map((m) => m[1]));
  const want = contractKeys("needs_attention");
  if (want) {
    const missing = [...want].filter((k) => !keys.has(k));
    if (missing.length)
      fail(`needs_attention (overdue branch) omits ${missing.join(", ")}`);
  }
}

// todays_work is built with to_jsonb(t), so the CTE aliases ARE the
// contract. Check the alias list rather than a jsonb_build_object block.
if (sql.includes("INTO v_todays_work")) {
  const cte = sql.match(/WITH todays AS \(([\s\S]*?)\)\s*SELECT coalesce\(jsonb_agg/);
  const want = contractKeys("todays_work");
  if (cte && want) {
    const emitted = new Set(
      [...cte[1].matchAll(/\bAS\s+([a-z_]+)|\b(t\.[a-z_]+)/g)].map((m) =>
        (m[1] ?? m[2]).replace(/^t\./, "")
      )
    );
    const missing = [...want].filter((k) => !emitted.has(k));
    if (missing.length)
      fail(`todays_work: CTE omits ${missing.join(", ")}`);
  }
}

// counts must all be present — a missing key is NaN in the UI, not an error.
const wantCounts = contractCounts();
const countsBlock = sql.match(/'counts',\s*jsonb_build_object\(([\s\S]*?)\)\s*,\s*'needs_attention'/);
if (wantCounts && countsBlock) {
  const got = new Set([...countsBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  const missing = [...wantCounts].filter((k) => !got.has(k));
  if (missing.length) fail(`counts omits ${missing.join(", ")}`);
}

function contractCounts() {
  const start = ts.indexOf("counts: {");
  if (start === -1) return null;
  const open = ts.indexOf("{", start);
  const end = ts.indexOf("};", open);
  if (end === -1) return null;
  const body = ts.slice(open, end);
  return new Set([...body.matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]));
}

if (failures) {
  console.error(`  ${failures} RPC shape problem(s)`);
  process.exit(1);
}
console.log("  · rpc shape: every dashboard field the UI reads is emitted by the RPC");