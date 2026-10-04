# Phase 1 — PWA QA checklist

Manual verification for the Serwist migration. Automated coverage lives in
`tests/pwa-foundation.test.ts` (28 tests) and `pnpm verify:pwa` (16 checks).

```bash
pnpm build        # required before verify:pwa
pnpm verify:pwa   # boots its own production server on :3211
```

> **Why no Lighthouse PWA audit:** Lighthouse removed its entire PWA category
> in v12. There is no longer a tool that reports installability, which is why
> `scripts/verify-pwa.mjs` asserts the underlying requirements directly.

---

## 1. Manifest

| # | Check | Expected |
|---|-------|----------|
| 1.1 | Visit `/manifest.json` | Valid JSON, `name`/`short_name` = Taskora |
| 1.2 | `display` | `standalone` |
| 1.3 | `start_url` and `scope` | Both `/` |
| 1.4 | Icons | Four entries: 192/512 × `any`/`maskable` |
| 1.5 | Each icon URL | `200`, `Content-Type: image/png`, correct pixel dimensions |
| 1.6 | `id` | `/` (stable app identity) |
| 1.7 | `orientation` | **Absent** — must not lock desktop installs to portrait |

## 2. Service worker

| # | Check | Expected |
|---|-------|----------|
| 2.1 | DevTools → Application → Service Workers | One worker at `/serwist/sw.js`, scope `/`, state **activated** |
| 2.2 | `curl -I /serwist/sw.js` | `200`, `Service-Worker-Allowed: /`, `Cache-Control` contains `must-revalidate` |
| 2.3 | Inspect the worker source | Contains `addEventListener("push"` and `addEventListener("notificationclick"` |
| 2.4 | `Application → Cache Storage` | Legacy `taskora-v1` cache from the old worker is gone |
| 2.5 | Second load | Network tab shows JS/CSS served from Cache Storage, HTML from network |

**Why the `Cache-Control` check matters.** The route is prerendered as a static
asset. Without an explicit override Next serves it with
`s-maxage=31536000` — a one-year CDN cache — and browsers would never pick up a
new worker. This was a real bug, caught by `pnpm verify:pwa`.

## 3. Offline

| # | Check | Expected |
|---|-------|----------|
| 3.1 | Load the app, then DevTools → Network → **Offline** | |
| 3.2 | Navigate to any page | Offline page renders, not a browser error |
| 3.3 | Go back online | App recovers on next navigation |
| 3.4 | Open a static asset while offline | Served from cache |

`verify:pwa` proves this by **stopping the server**, not by toggling Playwright's
offline flag. Playwright's `setOffline()` does not reliably reach fetches issued
by a service worker, which made the check pass against a live server. The script
now asserts the origin is unreachable *before* claiming anything about offline
behaviour.

## 4. Caching safety (most important)

| # | Check | Expected |
|---|-------|----------|
| 4.1 | Sign in, browse `/tasks`, `/payments` | |
| 4.2 | Inspect Cache Storage → every cache → keys | **No** entries for `/api/*`, no HTML documents, no RSC payloads |
| 4.3 | Only `/offline`, `/_next/static/*`, icons, fonts | Everything cached is static |

Serwist's stock `defaultCache` **does** cache same-origin HTML and RSC for 24h.
This app deliberately overrides it with a static-assets-only policy. On a
multi-user app a cached dashboard document would survive logout and could be
shown to the next person on the device. `verify:pwa` check 13 asserts this at
runtime; `tests/pwa-foundation.test.ts` asserts it in source.

## 5. Install prompt (Chromium)

| # | Check | Expected |
|---|-------|----------|
| 5.1 | Fresh profile, visit `/login` | Install card appears after ~3s |
| 5.2 | Click **Install** | Browser install dialog opens |
| 5.3 | Click **Not now** | Card hides; does not return for 14 days |
| 5.4 | Already installed | No install card |

## 6. Update flow

| # | Check | Expected |
|---|-------|----------|
| 6.1 | Build and redeploy | |
| 6.2 | With the app open, load the new build | "A new version of Taskora is ready" toast with **Reload** |
| 6.3 | Click Reload | Page reloads and is controlled by the new worker |
| 6.4 | Confirm no stale loop | The toast does not reappear repeatedly |

## 7. iOS

| # | Check | Expected |
|---|-------|----------|
| 7.1 | iOS Safari, **not** installed | "Add Taskora to Home Screen" guidance after ~5s |
| 7.2 | Tap Share → Add to Home Screen, then launch | Opens full-screen with no browser chrome |
| 7.3 | Already installed | No guidance shown |
| 7.4 | Pinch-zoom any page | **Zoom works** |

Safari never fires `beforeinstallprompt`, which is why step 7.1 exists at all.

**Zoom:** `maximumScale: 1` was removed from [app/layout.tsx](../app/layout.tsx).
It disabled pinch-zoom, failing WCAG 1.4.4 and Lighthouse's viewport audit.
`viewportFit: "cover"` is retained for notch/safe-area handling.

## 8. Accessibility & 404

| # | Check | Expected |
|---|-------|----------|
| 8.1 | Visit a nonexistent path | Branded 404 page with a way back |
| 8.2 | Pinch-zoom on mobile | Zoom enabled |
| 8.3 | Run an accessibility audit | No "viewport disallows zoom" finding |

---

## Known caveat: existing push subscriptions

Moving the worker from `/sw.js` to `/serwist/sw.js` **invalidates existing Web
Push subscriptions.** A push subscription's endpoint is bound to the service
worker script URL that created it, so subscriptions created before this deploy
will fail, and `lib/push.ts` prunes them on 404/410.

Affected users must re-subscribe. Phase 2 adds a "Send test notification" flow
and a re-enable path that makes this a one-click repair. Until then, expect a
temporary drop in push delivery for previously-subscribed devices.

## Dashboard settings required

**None.** No env vars, no Supabase, Vercel, or Google Cloud changes are needed
for Phase 1. The worker headers are set in the route response itself, so they
apply on Vercel without configuration.

One host-level requirement already satisfied: push and service workers need
HTTPS. Vercel provides it; `localhost` is exempt for development.