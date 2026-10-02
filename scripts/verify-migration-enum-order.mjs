// Guards against Postgres ERROR 55P04: "unsafe use of new value ...
// of enum type ... New enum values must be committed before they can
// be used."
//
// The rule Postgres enforces: if a migration runs
//   ALTER TYPE x ADD VALUE 'V';
// then no statement in that SAME migration may use 'V' as a value of
// x. A separate migration must commit first.
//
// This script reads every migration and reports any file that both
// adds an enum value and uses that same value afterwards. Run it
// before pushing a migration that touches an enum.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** Strip comments so documentation can't be mistaken for code. */
function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

let failures = 0;

for (const file of files) {
  const raw = readFileSync(join(dir, file), "utf8");
  const sql = stripComments(raw);

  // ALTER TYPE [schema.]<name> ADD VALUE '<value>'  (optionally IF NOT EXISTS)
  // The type may be schema-qualified, so the pattern must allow a dot.
  const added = [...sql.matchAll(
    /ALTER\s+TYPE\s+([\w.]+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi
  )].map((m) => ({
    type: m[1].split(".").pop(),
    value: m[2],
    index: m.index,
  }));

  if (added.length === 0) continue;

  for (const { type, value, index } of added) {
    // Search only AFTER the ADD VALUE statement itself.
    const after = sql.slice(index + 1);

    // A "use" is the value appearing as an enum literal in a typed
    // context. Comparing against pg_enum.enumlabel (TEXT) or
    // CREATE TYPE ... AS ENUM (...) does not count.
    const suspicious = [
      // compared against a column of that enum type
      { label: "column comparison", re: new RegExp(`\\b${type}\\s*=\\s*'${value}'`, "i") },
      // IN (...) against that enum type
      { label: "IN (...) list", re: new RegExp(`\\b${type}\\s+IN\\s*\\([^)]*'${value}'`, "i") },
      // cast to the enum type
      { label: "explicit cast", re: new RegExp(`'${value}'::${type}`, "i") },
      // written into a column of that enum type
      { label: "assignment to typed column", re: new RegExp(`role\\s*=\\s*'${value}'`, "i") },
    ].filter(({ re }) => re.test(after));

    if (suspicious.length > 0) {
      failures++;
      console.log(
        `FAIL ${file}: uses ${type}.${value} in the same migration that adds it`
      );
      for (const s of suspicious) console.log(`       -> ${s.label}`);
      console.log(
        `       Fix: move the ADD VALUE into an earlier migration file so it commits first.`
      );
    } else {
      console.log(`ok   ${file}: ${type}.${value} added and not used in this file`);
    }
  }
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"}: enum add/use ordering across ${files.length} migrations`
);
if (failures > 0) process.exit(1);