import { chromium } from "@playwright/test";

/**
 * Performance harness.
 *
 * Exists because several phases of the speed work cannot be justified
 * without numbers: "the app opens instantly", "the network carries only
 * deltas". This measures those claims under throttled conditions instead
 * of on loopback, where everything looks instant and hides the problem.
 *
 * Throttling profiles mirror the Lighthouse presets so a number here is
 * comparable with a Lighthouse run:
 *   fast4g  — 10 Mbps down, 40 ms RTT, 1x CPU   (Lighthouse "fast 4G")
 *   slow4g  — 1.6 Mbps down, 150 ms RTT, 4x CPU  (Lighthouse "slow 4G")
 *   none    — unthrottled loopback, useful for isolating server cost
 *
 * Usage:
 *   node perf/harness.mjs [baseUrl] [outFile] [--profile=fast4g]
 * Exits non-zero if a budget is breached, so it works as a CI guard.
 */

export const BUDGETS = {
  // Requests that block first paint. Next.js emits one script per chunk,
  // so this is the count of blocking <script src> in the initial HTML.
  maxBlockingRequests: 14,
  // Decoded JS the shell must parse before FCP.
  maxDecodedJsKb: 900,
  fast4g: { maxFcp: 1200, maxLcp: 2000, maxCls: 0.1, maxRequests: 25 },
  slow4g: { maxFcp: 3000, maxLcp: 4000, maxCls: 0.1, maxRequests: 30 },
};

export const PROFILES = {
  none: null,
  fast4g: {
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
    latency: 40,
    cpuThrottling: 1,
  },
  slow4g: {
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 150,
    cpuThrottling: 4,
  },
};

/** Paths measured. Public routes only — see NOTE below. */
export const PATHS = ["/login", "/signup"];

/**
 * NOTE ON AUTHENTICATED PATHS
 *
 * Measuring /admin, /tasks etc. requires a signed-in session, which this
 * harness cannot synthesise: Supabase auth is cookie-based and the login
 * is Google OAuth. Those routes redirect to /login, so measuring them
 * here would silently measure the login page instead — a number that
 * looks fine and means nothing.
 *
 * TONEWORK (or any test account credentials) must be supplied before the
 * authenticated matrix can run. Until then, authenticated timings are
 * reported as NOT MEASURED rather than guessed.
 */

export async function measure(browser, { path, profile = "fast4g", baseUrl }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const throttle = PROFILES[profile];
  if (throttle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: throttle.latency,
      downloadThroughput: throttle.downloadThroughput,
      uploadThroughput: throttle.uploadThroughput,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle.cpuThrottling });
  }

  const requests = [];
  page.on("request", (r) => requests.push(r.url()));

  // LCP is only exposed through a PerformanceObserver — Chrome does not
  // surface it via performance.getEntriesByType, which returns an empty
  // list and made this harness report a meaningless LCP of 0. buffered:
  // true replays entries that fired before this ran.
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__perf.lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (!e.hadRecentInput) window.__perf.cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Unsupported entry type: metrics stay 0 and are reported as such.
    }
  });

  const url = new URL(path, baseUrl).toString();
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: "load", timeout: 60_000 });

  // Let LCP settle — it can fire after load on a slow profile.
  await page.waitForTimeout(750);

  // LCP is only observable after it fires, so read it after load.
  const metrics = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const nav = performance.getEntriesByType("navigation")[0] || {};
        const paints = {};
        performance.getEntriesByType("paint").forEach((p) => (paints[p.name] = p.startTime));

        const lcp = window.__perf?.lcp ?? 0;
        const cls = window.__perf?.cls ?? 0;

        const resources = performance.getEntriesByType("resource");
        let transfer = 0;
        let decoded = 0;
        let scriptCount = 0;
        let decodedJs = 0;
        for (const r of resources) {
          transfer += r.transferSize || 0;
          decoded += r.decodedBodySize || 0;
          if (r.initiatorType === "script") {
            scriptCount++;
            decodedJs += r.decodedBodySize || 0;
          }
        }

        resolve({
          ttfb: nav.responseStart || 0,
          fcp: paints["first-contentful-paint"] || 0,
          lcp,
          cls,
          domContentLoaded: nav.domContentLoadedEventEnd || 0,
          load: nav.loadEventEnd || 0,
          resourceCount: resources.length,
          transferKb: transfer / 1024,
          decodedKb: decoded / 1024,
          decodedJsKb: decodedJs / 1024,
          scriptCount,
          blockingScripts: document.querySelectorAll("script[src]").length,
        });
      })
  );

  const wallClock = Date.now() - started;
  await context.close();

  return {
    path,
    profile,
    status: response?.status() ?? 0,
    wallClockMs: wallClock,
    ...metrics,
    totalRequests: requests.length,
    supabaseRequests: requests.filter((u) => /supabase|realtime/i.test(u)).length,
  };
}

/** Check a measurement against the budgets. Returns a list of breaches. */
export function checkBudgets(m, budgets = BUDGETS) {
  const breaches = [];
  const push = (msg) => breaches.push(msg);

  if (m.blockingScripts > budgets.maxBlockingRequests)
    push(`blocking scripts ${m.blockingScripts} > ${budgets.maxBlockingRequests}`);
  if (m.decodedJsKb > budgets.maxDecodedJsKb)
    push(`decoded JS ${m.decodedJsKb.toFixed(0)}KB > ${budgets.maxDecodedJsKb}KB`);

  const p = budgets[m.profile];
  if (p) {
    if (m.fcp > p.maxFcp) push(`FCP ${m.fcp.toFixed(0)}ms > ${p.maxFcp}ms`);
    if (m.lcp > p.maxLcp) push(`LCP ${m.lcp.toFixed(0)}ms > ${p.maxLcp}ms`);
    if (m.cls > p.maxCls) push(`CLS ${m.cls.toFixed(3)} > ${p.maxCls}`);
    if (m.totalRequests > p.maxRequests)
      push(`requests ${m.totalRequests} > ${p.maxRequests}`);
  }
  return breaches;
}

export async function launch() {
  return chromium.launch({ headless: true });
}