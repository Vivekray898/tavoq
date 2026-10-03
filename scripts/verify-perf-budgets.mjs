#!/usr/bin/env node
/**
 * Static performance guard.
 *
 * Runs in the normal test suite (no browser, no server) and fails on the
 * two regressions most likely to creep back in unnoticed:
 *
 *   1. Initial JS growing past the budget. This is the number that
 *      actually decides cold-load time, and unlike FCP it is fully
 *      deterministic — a build either ships 799KB or it does not.
 *   2. The shell drifting back toward client-side fetching, which is what
 *      turns "one bootstrap" into "a dozen startup queries".
 *
 * The dynamic measurements (FCP/LCP under throttling) live in
 * perf/measure.mjs and run in CI against a production build.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * Budget: total JS the build may ship.
 *
 * This is an UPPER BOUND over every chunk, not the bytes one page loads.
 * It is deliberately the coarse number: a single-route figure depends on
 * chunk splitting that changes without anything regressing, so it churns
 * and trains people to ignore the guard. The precise per-load figure is
 * measured by perf/measure.mjs against a real browser; this one only has
 * to catch a large dependency or a whole new vendor landing in the build.
 */
const MAX_STATIC_JS_BYTES = 2600 * 1024;

function fail(msg) {
  console.error(`  ✖ ${msg}`);
  process.exitCode = 1;
}

// ── 1. Static JS budget ───────────────────────────────────────────────
//
// Measured by walking .next/static/chunks, NOT build-manifest.json.
//
// The first version of this read `rootMainFiles` and reported 429KB. That
// field is the Pages Router shape: under the App Router it lists 6 files
// while the browser actually loads 12 scripts totalling 799KB. The guard
// was measuring a set that is not what ships, so a real regression could
// pass it silently. Walking the chunks directory measures everything the
// build can serve, whatever the router.

const chunksDir = join(ROOT, ".next", "static", "chunks");
if (!existsSafe(chunksDir)) {
  console.log("  · no build output — skipping JS budget (run `pnpm build` first)");
} else {
  let total = 0;
  let count = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (entry.endsWith(".js")) {
        total += s.size;
        count++;
      }
    }
  };
  walk(chunksDir);

  const kb = Math.round(total / 1024);
  console.log(`  · static JS shipped: ${kb}KB across ${count} chunks`);
  if (total > MAX_STATIC_JS_BYTES)
    fail(
      `static JS ${kb}KB exceeds ${Math.round(MAX_STATIC_JS_BYTES / 1024)}KB budget`
    );
}

// ── 2. Startup query discipline ──────────────────────────────────────
// The shell providers are the first thing to load on every page. If one
// of them starts fetching independently, we are back to N round-trips.

const providers = join(ROOT, "components", "providers");
const offenders = [];
for (const f of readdirSync(providers)) {
  if (!f.endsWith(".tsx")) continue;
  const src = readFileSync(join(providers, f), "utf8");
  // query-provider legitimately wraps the client without fetching.
  if (f === "query-provider.tsx" || f === "session-provider.tsx") continue;
  const q = (src.match(/useQuery\(|useSuspenseQuery\(/g) ?? []).length;
  const ch = (src.match(/\.channel\(/g) ?? []).length;
  if (q > 1 || ch > 1) offenders.push(`${f} (queries=${q}, channels=${ch})`);
}
if (offenders.length)
  fail(`shell providers must not fan out requests: ${offenders.join(", ")}`);
else console.log("  · shell providers: single subscription each");

function existsSafe(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}