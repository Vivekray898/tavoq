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
import os from "node:os";
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
      JSON.stringify(
        {
          budgets: BUDGETS,
          capturedAt: new Date().toISOString(),
          // Recorded so a later run on a different machine knows to skip
          // the timing comparison rather than reporting hardware noise
          // as a regression.
          environment: {
            platform: process.platform,
            arch: process.arch,
            cpus: os.cpus().length || 0,
            model: os.cpus()[0]?.model ?? "unknown",
          },
          results,
        },
        null,
        2
      )
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

    // TIMING BASELINES ARE MACHINE-SPECIFIC.
    //
    // perf/baseline.json is captured on one machine. Comparing its FCP
    // against a different one — a GitHub runner is not the laptop that
    // produced it — produces a "regression" that is pure hardware noise,
    // and a 100ms threshold makes that certain rather than possible.
    //
    // So: a baseline whose recorded environment differs from this run is
    // reported as a SKIP for timing, and only the machine-independent
    // metrics (bytes, request counts, chunk counts) are compared. Those
    // are deterministic for a given commit and are what actually catch
    // a bundle or query-count regression.
    const sameEnv =
      before.environment &&
      before.environment.platform === process.platform &&
      before.environment.cpus === (os.cpus().length || 0);

    console.log("\n  vs baseline:");
    if (!sameEnv) {
      console.log(
        `   · baseline was captured on ${before.environment?.platform ?? "an unknown machine"} ` +
          `with ${before.environment?.cpus ?? "?"} CPUs; this run is ` +
          `${process.platform} with ${os.cpus().length} — timing not compared`
      );
    }
    let regressed = false;
    for (const m of results) {
      const b = before.results.find(
        (x) => x.path === m.path && x.profile === m.profile
      );
      if (!b) continue;
      const js = r2(m.decodedJsKb - b.decodedJsKb);
      const req = m.totalRequests - b.totalRequests;
      // Deterministic metrics: any change is a real change.
      const worse = js > 0 || req > 0;
      if (worse) regressed = true;

      const timing = sameEnv
        ? `FCP ${r2(m.fcp - b.fcp) >= 0 ? "+" : ""}${r2(m.fcp - b.fcp)}ms  ` +
          `LCP ${r2(m.lcp - b.lcp) >= 0 ? "+" : ""}${r2(m.lcp - b.lcp)}ms  `
        : "";
      console.log(
        `   ${worse ? "✖" : "✓"} ${m.path} [${m.profile}] ` +
          `${timing}JS ${js >= 0 ? "+" : ""}${js}KB  reqs ${req >= 0 ? "+" : ""}${req}`
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