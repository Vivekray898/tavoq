import { spawn, execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../perf/harness.mjs";

/**
 * Phase 1 — PWA verification.
 *
 * This exists because Lighthouse REMOVED its entire PWA category in v12, so
 * there is no longer a tool that will tell you an app is installable. What
 * follows asserts the underlying requirements directly, against a real
 * production build in a real browser — the things a PWA audit used to score.
 *
 * Checks:
 *   1. the manifest parses and every declared icon really serves a PNG
 *   2. /serwist/sw.js serves 200 with Service-Worker-Allowed: / and no-store
 *   3. the worker registers and reaches "activated"
 *   4. an offline navigation is answered by the precached /offline fallback
 *   5. authenticated surfaces (/api/*, RSC payloads, documents) are NEVER
 *      served from Cache Storage
 *
 * Check 5 is the important one. Serwist's stock `defaultCache` caches
 * same-origin HTML and RSC for 24h; this app overrides it with a
 * static-assets-only policy, and this check is what proves the override holds
 * at runtime rather than merely in the source.
 *
 * Usage: pnpm verify:pwa   (requires a prior `pnpm build`)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = `${HERE}/..`;
const PORT = Number(process.env.PWA_PORT ?? 3211);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Stop the server for real.
 *
 * `npx next start` runs the actual server as a CHILD process, so signalling
 * the wrapper (or even its process group) can leave the listener alive. The
 * offline check then runs against a live origin and passes for the wrong
 * reason, so this escalates to a port-based sweep and finally polls the
 * origin until it genuinely stops answering.
 */
function stopServer(proc) {
  // Group first, while the leader still exists.
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // no group or already gone
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    // already gone
  }
  try {
    const pids = execSync(`lsof -ti tcp:${PORT}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (pids) execSync(`kill -9 ${pids.split(/\s+/).join(" ")}`);
  } catch {
    // lsof found nothing, or is unavailable — the poll below is the real guard
  }
}

async function originIsDown() {
  try {
    await fetch(`${BASE}/manifest.json`, { cache: "no-store" });
    return false;
  } catch {
    return true;
  }
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group. `npx next start` runs the real server as a CHILD,
      // so signalling the npx wrapper alone leaves the server listening and the
      // "offline" check silently runs against a live origin — which is exactly
      // the false pass this script previously produced.
      detached: true,
    });
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new Error("server start timeout")), 90_000);
    let stderr = "";
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    proc.stdout.on("data", (b) => {
      if (b.toString().includes("Ready") || b.toString().includes("started server")) {
        clearTimeout(timer);
        setTimeout(() => done(resolve, proc), 500);
      }
    });
    proc.on("error", (e) => done(reject, e));
    proc.on("exit", (c) =>
      done(reject, new Error(`server exited ${c}\n${stderr.slice(-800)}`))
    );
  });
}

async function main() {
  const server = await startServer();
  const browser = await launch();
  try {
    // ── 1. manifest + icons ───────────────────────────────────────────────
    const mfRes = await fetch(`${BASE}/manifest.json`);
    check("manifest.json serves 200", mfRes.status === 200, `status ${mfRes.status}`);
    const manifest = await mfRes.json();
    check(
      "manifest has the installability fields",
      Boolean(
        manifest.name &&
          manifest.short_name &&
          manifest.start_url === "/dashboard" &&
          manifest.scope === "/" &&
          manifest.display === "standalone"
      ),
      `display=${manifest.display} start_url=${manifest.start_url}`
    );
    for (const icon of manifest.icons ?? []) {
      const r = await fetch(`${BASE}${icon.src}`);
      const ct = r.headers.get("content-type") ?? "";
      check(
        `icon ${icon.sizes} ${icon.purpose} serves a PNG`,
        r.status === 200 && ct.includes("image/png"),
        `status ${r.status} type ${ct}`
      );
    }

    // ── 2. the worker itself ──────────────────────────────────────────────
    const swRes = await fetch(`${BASE}/serwist/sw.js`);
    const swa = swRes.headers.get("service-worker-allowed");
    const cc = swRes.headers.get("cache-control") ?? "";
    check("sw.js serves 200", swRes.status === 200, `status ${swRes.status}`);
    check(
      "sw.js is scoped to the whole origin",
      swa === "/",
      `Service-Worker-Allowed: ${swa ?? "(absent)"}`
    );
    check(
      "sw.js is revalidated, not CDN-cached",
      /must-revalidate|no-store|no-cache/.test(cc),
      `Cache-Control: ${cc || "(absent)"}`
    );
    const swText = await swRes.text();
    check(
      "generated worker contains the push handler",
      swText.includes('addEventListener("push"'),
      "Web Push must survive the move to Serwist"
    );
    check(
      "generated worker contains the notificationclick handler",
      swText.includes('addEventListener("notificationclick"')
    );

    // ── 3. registration reaches activated ─────────────────────────────────
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "load" });

    const swState = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { ok: false, why: "unsupported" };
      const reg = await navigator.serviceWorker
        .register("/serwist/sw.js", { scope: "/" })
        .catch((e) => ({ error: String(e) }));
      if (!reg || reg.error) return { ok: false, why: reg?.error ?? "register failed" };
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) =>
          navigator.serviceWorker.addEventListener("controllerchange", r, { once: true })
        );
      }
      return {
        ok: true,
        scope: reg.scope,
        state: reg.active?.state ?? "none",
        controlled: Boolean(navigator.serviceWorker.controller),
      };
    });
    check(
      "service worker registers and activates at scope /",
      swState.ok && swState.state === "activated" && swState.scope.endsWith("/"),
      JSON.stringify(swState)
    );

    // Let the precache settle so the offline fallback is actually populated.
    await page.waitForTimeout(1500);

    // ── 4. authenticated surfaces never come from Cache Storage ──────────
    // Done BEFORE the offline test because that one shuts the server down.
    // Warm the caches with real traffic first, then inspect what was stored.
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.goto(`${BASE}/offline`, { waitUntil: "load" });
    await page.waitForTimeout(800);

    const audit = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const stored = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          const url = new URL(req.url);
          stored.push({
            cache: name,
            url: url.pathname,
            // A document or RSC payload in a cache is the failure we care about.
            kind: req.destination,
            rsc: req.headers.get("rsc") ?? req.headers.get("RSC"),
          });
        }
      }
      return { cacheNames, stored };
    });

    const offenders = audit.stored.filter(
      (e) =>
        e.url.startsWith("/api/") ||
        e.kind === "document" ||
        (e.rsc === "1" && e.url !== "/offline")
    );
    check(
      "no /api, document, or RSC response is stored in Cache Storage",
      offenders.length === 0,
      offenders.length
        ? `leaked: ${offenders.slice(0, 4).map((o) => o.url).join(", ")}`
        : `${audit.stored.length} entries across ${audit.cacheNames.length} caches, all static`
    );

    // And confirm the fallback page IS precached, or the offline test below
    // would pass by accident.
    const hasOffline = audit.stored.some((e) => e.url === "/offline");
    check("/offline is present in the precache", hasOffline);

    // ── 5. offline navigation is answered by the fallback ────────────────
    // The server is genuinely stopped rather than using context.setOffline().
    // Playwright's offline emulation does not reliably reach fetches issued
    // by the service worker, so setOffline() alone let the navigation succeed
    // against the live server and produced a false pass. With the server down
    // there is no network path at all, so anything rendered must have come
    // from the worker's precache.
    stopServer(server);
    for (let i = 0; i < 15 && !(await originIsDown()); i += 1) {
      await new Promise((r) => setTimeout(r, 400));
    }

    // Precondition: prove the origin is genuinely unreachable before claiming
    // anything about offline behaviour. Without this the check can pass simply
    // because the server answered.
    const stillUp = !(await originIsDown());
    check("origin is unreachable before the offline test", !stillUp);
    if (stillUp) {
      throw new Error("server still listening; offline check would be meaningless");
    }

    let offlineOk = false;
    let offlineDetail = "";
    try {
      await page.goto(`${BASE}/tasks`, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      const text = await page.evaluate(() => document.body.innerText);
      offlineOk = /offline/i.test(text);
      offlineDetail = offlineOk ? "rendered offline page" : `got: ${text.slice(0, 100)}`;
    } catch (err) {
      offlineDetail = `navigation failed: ${String(err).slice(0, 120)}`;
    }
    check(
      "offline navigation is served by the /offline fallback",
      offlineOk,
      offlineDetail
    );
  } finally {
    await browser.close();
    try {
      stopServer(server);
    } catch {
      // already stopped by the offline check
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log(`FAILED: ${failed.map((f) => f.name).join("; ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-pwa failed to run:", err?.message ?? err);
  process.exitCode = 1;
});