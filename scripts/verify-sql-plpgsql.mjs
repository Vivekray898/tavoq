#!/usr/bin/env node
/**
 * Static PL/pgSQL sanity check.
 *
 * The dashboard bootstrap RPC cannot be executed here — no psql, no
 * database password — so a typo would otherwise surface only when the
 * migration is applied, in production, on top of a change that is meant
 * to be safe.
 *
 * SCOPE, DELIBERATELY NARROW
 * The first version also tried to check `SELECT ... INTO` arity. It
 * produced false positives on valid code: it read
 * `jsonb_agg(to_jsonb(s) || jsonb_build_object(...))` as a multi-column
 * select list, and it reported undeclared variables inside migration 008,
 * which has shipped and runs in production. A guard that reports known-good
 * code as broken trains people to ignore it, so that check was removed
 * rather than tuned.
 *
 * What remains is one check that is reliable by construction: a v_ name
 * used in a function body but absent from its DECLARE block. Only
 * functions authored in this project (migration 022 onward) are checked,
 * because older files use conventions this parser does not model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");

// Migrations this project wrote. Earlier ones predate this check and are
// verified by actually running them.
const CHECK_FROM = "022_";

let failures = 0;
const fail = (file, msg) => {
  console.error(`  ✖ ${file}: ${msg}`);
  failures++;
};

const files = readdirSync(DIR)
  .filter((n) => n.endsWith(".sql"))
  .filter((n) => n >= CHECK_FROM)
  .sort();

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8").replace(/--[^\n]*/g, "");

  for (const fn of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?\$\$([\s\S]*?)\$\$\s*;/gi
  )) {
    const body = fn[1];
    const declareMatch = body.match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i);
    if (!declareMatch) continue;

    const declared = new Set();
    for (const d of declareMatch[1].matchAll(
      /\b([a-z_][a-z0-9_]*)\s+(?:bigint|int|numeric|text|jsonb|json|uuid|timestamptz|boolean|date|record)\b/gi
    )) {
      declared.add(d[1].toLowerCase());
    }
    for (const k of ["found", "sqlstate", "sqlerrm", "rowcount"]) declared.add(k);

    const used = new Set();
    for (const u of body.matchAll(/\b(v_[a-z0-9_]+)\b/gi)) used.add(u[1].toLowerCase());

    for (const u of used) {
      if (!declared.has(u)) fail(f, `uses "${u}", which is never declared`);
    }
  }
}

if (failures) {
  console.error(`  ${failures} plpgsql problem(s)`);
  process.exit(1);
}
console.log(`  · plpgsql: ${files.length} migration(s) checked, no undeclared variables`);