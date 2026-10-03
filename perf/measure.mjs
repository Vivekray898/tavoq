#!/usr/bin/env node
/**
 * Performance runner.
 *
 *   node perf/measure.mjs                     # measure + check budgets
 *   node perf/measure.mjs --save baseline     # write perf/baseline.json
 *   node perf/measure.mjs --compare after     # diff against baseline, exit 1 on regression
 *
 * Starts its own production server so the number reflects a real build,
 * not the dev server's module graph.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { measure, checkBudgets, launch, PATHS, BUDGETS } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.PERF_PORT ?? 3210);

const argv = process.argv.slice(2);

/**
 * Reads both `--name=value` and `--name value`.
 *
 * Only the `=` form was handled at first, so the documented
 * `--save baseline` silently did nothing and the runner reported success
 * without ever writing a baseline — a guard that cannot fail.
 */
function flag(name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return null;
}

const profiles = (flag("profile") ?? "fast4g,slow4g").split(",");

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new Error("server start timeout")), 60_000);
    proc.stdout.on("data", (b) => {
      if (b.toString().includes("Ready")) {
        clearTimeout(timer);
        setTimeout(() => done(resolve, proc), 400);
      }
    });
    proc.on("error", (e) => done(reject, e));
    proc.on("exit", (c) => done(reject, new Error(`server exited ${c}`)));
  });
}

const r2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const server = await startServer();
  const browser = await launch();
  const results = [];
  try {
    for (const profile of profiles) {
      for (const path of PATHS) {
        const m = await measure(browser, {
          path,
          profile,
          baseUrl: `http://127.0.0.1:${PORT}`,
        });
        results.push(m);
      }
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }

  console.log("\n  path      profile  FCP     LCP     CLS    reqs  JS(KB)  xfer(KB)  supa");
  console.log("  " + "-".repeat(74));
  for (const m of results) {
    console.log(
      `  ${m.path.padEnd(9)} ${m.profile.padEnd(7)} ` +
        `${r2(m.fcp).toFixed(0).padStart(5)}ms ${r2(m.lcp).toFixed(0).padStart(5)}ms ` +
        `${m.cls.toFixed(3).padStart(6)} ${String(m.totalRequests).padStart(5)} ` +
        `${m.decodedJsKb.toFixed(0).padStart(6)} ${m.transferKb.toFixed(0).padStart(8)} ` +
        `${String(m.supabaseRequests).padStart(5)}`
    );
  }

  const breaches = results.flatMap((m) =>
    checkBudgets(m).map((b) => `${m.path} [${m.profile}]: ${b}`)
  );

  if (breaches.length) {
    console.log("\n  BUDGET BREACHES:");
    for (const b of breaches) console.log(`   ✖ ${b}`);
  } else {
    console.log("\n  ✓ all budgets met");
  }

  const save = flag("save");
  if (save) {
    const file = join(HERE, `${save}.json`);
    writeFileSync(
      file,
      JSON.stringify({ budgets: BUDGETS, capturedAt: new Date().toISOString(), results }, null, 2)
    );
    console.log(`\n  saved → ${file}`);
  }

  const compare = flag("compare");
  if (compare) {
    const file = join(HERE, `${compare}.json`);
    if (!existsSync(file)) {
      console.log(`\n  ✖ no baseline at ${file} — run with --save baseline first`);
      process.exit(1);
    }
    const before = JSON.parse(readFileSync(file, "utf8"));
    console.log("\n  vs baseline:");
    let regressed = false;
    for (const m of results) {
      const b = before.results.find(
        (x) => x.path === m.path && x.profile === m.profile
      );
      if (!b) continue;
      const delta = (k) => r2(m[k] - b[k]);
      const fcp = delta("fcp");
      const lcp = delta("lcp");
      const js = delta("decodedJsKb");
      const req = delta("totalRequests");
      const worse = fcp > 100 || lcp > 200 || js > 10 || req > 0;
      if (worse) regressed = true;
      console.log(
        `   ${worse ? "✖" : "✓"} ${m.path} [${m.profile}] ` +
          `FCP ${fcp >= 0 ? "+" : ""}${fcp}ms  LCP ${lcp >= 0 ? "+" : ""}${lcp}ms  ` +
          `JS ${js >= 0 ? "+" : ""}${js}KB  reqs ${req >= 0 ? "+" : ""}${req}`
      );
    }
    if (regressed) {
      console.log("\n  REGRESSION vs baseline");
      process.exit(1);
    }
  }

  process.exit(breaches.length ? 1 : 0);
}

main().catch((e) => {
  console.error("perf run failed:", e.message);
  process.exit(2);
});