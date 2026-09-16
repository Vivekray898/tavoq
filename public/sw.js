/* Taskora service worker — minimal and safe (§41).
 * - Navigations: network-first, fall back to /offline page when unreachable.
 * - Static assets: stale-while-revalidate.
 * - Never touches Supabase API calls (always network).
 */
const VERSION = "taskora-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────
// Web Push (§20) — real system notifications even when the app is
// closed. Payload: { title, body, url, tag }.
// ──────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Taskora", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Taskora";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/notifications" },
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click → focus the app on the relevant screen (§69)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/notifications";
  const url = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing window if we have one
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept Supabase or cross-origin requests
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/realtime") || url.pathname.includes("supabase")) return;

  // App navigations: network-first with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful navigations of static-ish pages? Keep it simple:
          // just pass through.
          return response;
        })
        .catch(() =>
          caches.match(OFFLINE_URL).then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
