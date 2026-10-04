import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Phase 1 — serves the generated service worker from /serwist/sw.js.
 *
 * Why a Route Handler instead of a static public/sw.js: Next 16 builds with
 * Turbopack by default and Turbopack does not support webpack plugins, so the
 * classic @serwist/next integration would fail `next build`. Serwist 9.5's
 * @serwist/turbopack integration bundles the worker at request time instead.
 *
 * The route sets `Service-Worker-Allowed: /` (see the package source), which
 * is what lets a worker served from /serwist/ control the whole origin — the
 * app is otherwise un-serviced below that path.
 *
 * The precache revision changes whenever the git HEAD changes, so the offline
 * page is re-fetched after a deploy instead of serving a stale copy.
 */
const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ??
  crypto.randomUUID();

/**
 * Route segment configuration, re-exported straight from Serwist.
 *
 * These MUST stay in destructured-export form: Next parses `dynamic` and
 * `dynamicParams` statically at compile time and rejects property access on a
 * named variable ("it needs to be a static string/boolean"). Assigning them
 * from `serwistRoute.dynamic` builds fine under `tsc` and fails `next build`,
 * which is exactly the regression this shape avoids.
 */
export const {
  dynamic,
  dynamicParams,
  revalidate,
  generateStaticParams,
  GET: serwistGET,
} = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/offline", revision }],
  swSrc: "app/sw.ts",
  // Bundle with the native esbuild rather than the wasm build.
  useNativeEsbuild: true,
});

/**
 * Force revalidation on the worker.
 *
 * The route is prerendered as a static asset, so without this Next serves it
 * with `Cache-Control: s-maxage=31536000` — a one-year CDN cache. A browser
 * would then never re-download the worker and would keep running the old
 * precache manifest indefinitely. `pnpm verify:pwa` caught exactly this.
 *
 * The header is set here rather than only in vercel.json because vercel.json
 * applies only on Vercel; setting it on the response makes the behaviour
 * correct in every environment, including a bare `next start`.
 */
export const GET = async (
  request: Request,
  context: { params: Promise<{ path: string }> }
) => {
  const res = await serwistGET(request, context);
  res.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  res.headers.set("Service-Worker-Allowed", "/");
  return res;
};