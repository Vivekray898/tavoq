/// <reference lib="esnext" />
/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

/**
 * Phase 1 — PWA foundation.
 *
 * Generated at request time by app/serwist/[path]/route.ts and served from
 * /serwist/sw.js with `Service-Worker-Allowed: /`, so it controls the whole
 * origin even though it lives under a sub-path.
 *
 * ── Caching policy ───────────────────────────────────────────────────────
 * Serwist's recommended `defaultCache` runtime-caches same-origin HTML and
 * RSC payloads (NetworkFirst, `pages` / `pages-rsc`, 24h). That is deliberately
 * NOT used here. This is a multi-user app behind auth: a cached dashboard
 * document is a real session's page sitting in Cache Storage where it survives
 * logout and can be served to the next person to use the device. The rule for
 * this app is the one in the phase spec — never cache auth or mutation
 * requests — so the list below is deliberately narrower than the default:
 *
 *   • static assets (_next/static, fonts, images, icons) → cached
 *   • documents, RSC payloads, and anything under /api → network only
 *   • anything not matched → network only
 *
 * Consequence, stated plainly: repeat visits are fast because the JS and CSS
 * come from cache, but the HTML shell is always fetched. There is no offline
 * document rendering beyond the precached /offline page. That is the intended
 * trade — a cached authenticated page is a worse failure than a spinner.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_URL = "/offline";

/** Cache written by the pre-Serwist public/sw.js. Cleared on activate. */
const LEGACY_CACHE = "taskora-v1";

const OFFLINE_FALLBACK = {
  entries: [
    {
      url: OFFLINE_URL,
      matcher({ request }: { request: Request }) {
        return request.destination === "document";
      },
    },
  ],
};

/**
 * Static assets only. Every entry is scoped to same-origin AND explicitly
 * excluded from /api, so a future route under /api can never be swept into a
 * cache by a broad matcher.
 */
/**
 * Navigation handler: network first, precached offline page on failure.
 *
 * This exists as an explicit strategy rather than relying on Serwist's
 * `fallbacks` option. Runtime-caching routes are registered by the constructor
 * BEFORE `addEventListeners()` registers the fallback route, and Workbox's
 * router does not fall through to a later matching route when an earlier one
 * throws — so a `NetworkOnly` document rule placed among the runtime entries
 * swallows every navigation and the offline page is never served. Verified by
 * `pnpm verify:pwa`, which failed exactly this way before the fix.
 *
 * Writing it as the first runtime entry also makes the ordering explicit
 * rather than emergent.
 */
class NetworkFirstWithOfflineFallback extends NetworkOnly {
  async handle({ request, event }: { request: Request; event: ExtendableEvent }) {
    try {
      return await super.handle({ request, event } as never);
    } catch {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      const cached = await cache.match(OFFLINE_URL);
      return (
        cached ??
        new Response("<h1>You are offline</h1>", {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      );
    }
  }
}

/** Precache cache name Serwist writes, so the fallback page can be read back. */
const OFFLINE_CACHE_NAME = "serwist-precache-v2-" + self.registration.scope;

const runtimeCaching = [
  // Navigations first — see the class comment above for why ordering matters.
  {
    matcher: ({ request }: { request: Request }) => request.destination === "document",
    handler: new NetworkFirstWithOfflineFallback(),
  },
  // Immutable, content-hashed build output. Safe to cache forever.
  {
    matcher: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "next-static",
      plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 31536000 })],
    }),
  },
  // Build output that is not content-hashed (manifest.webmanifest, sw.js route).
  {
    matcher: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith("/_next/") && !url.pathname.startsWith("/api/"),
    handler: new StaleWhileRevalidate({
      cacheName: "next-assets",
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 })],
    }),
  },
  {
    matcher: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith("/icons/"),
    handler: new CacheFirst({
      cacheName: "icons",
      plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 31536000 })],
    }),
  },
  {
    matcher: /\.(?:eot|otf|ttc|ttf|woff2?)$/i,
    handler: new CacheFirst({
      cacheName: "fonts",
      plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 31536000 })],
    }),
  },
  {
    matcher: /\.(?:png|jpe?g|gif|svg|ico|webp|avif)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "images",
      plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 2592000 })],
    }),
  },

  // ── Never cached ────────────────────────────────────────────────────────
  // Auth and session traffic. Explicit and unmissable.
  {
    matcher: ({ url }: { url: URL }) => url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  // React Server Component payloads: per-user, must never outlive a response.
  {
    matcher: ({ request }: { request: Request }) =>
      request.headers.get("RSC") === "1" ||
      request.headers.get("Next-Router-Prefetch") === "1",
    handler: new NetworkOnly(),
  },
  // HTML documents are handled by the first entry above, which never stores a
  // document in a cache — it only reads the precached /offline page.
  // Anything unlisted — including cross-origin. Default deny.
  // Exclude cross-origin requests so third-party beacons (e.g. Cloudflare
  // analytics) pass through to the browser instead of being rejected by the
  // service worker's NetworkOnly handler.
  {
    matcher: ({ url }: { url: URL }) => url.origin === self.location.origin,
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: OFFLINE_FALLBACK,
  // The offline page is added to the precache by additionalPrecacheEntries in
  // app/serwist/[path]/route.ts, not here — SerwistOptions does not accept it,
  // and that is where the git-derived revision is available.
});

// Drop the cache left behind by the hand-rolled worker this replaces. Serwist
// cleans its own precache between versions but knows nothing about this name.
serwist.addEventListeners();

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k === LEGACY_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Web Push (Phase 2 groundwork — behaviour preserved exactly from the
// pre-Serwist public/sw.js, which tests/calendar-push.test.ts asserts on).
//
// Payload: { title, body, url, tag }. A non-JSON payload must not throw: push
// services, and some browser/OS combinations, deliver plain text.
// ───────────────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Taskora", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Taskora";
  // `vibrate` is a real NotificationOptions member at runtime (and supported by
  // Chromium and Android) but is missing from the DOM lib's declaration, and
  // this file loads both the dom and webworker libs. Intersecting adds it
  // without weakening the rest of the shape.
  const options: NotificationOptions & { vibrate?: number[] } = {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/notifications" },
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click → focus the app on the relevant screen rather than opening a
// duplicate tab. Coerced to a same-origin absolute URL first so a hostile or
// stale payload cannot turn this into a redirect off-origin.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/notifications";
  let url = new URL("/notifications", self.location.origin).href;
  try {
    const candidate = new URL(target, self.location.origin);
    if (candidate.origin === self.location.origin) url = candidate.href;
  } catch {
    // keep the safe default
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});