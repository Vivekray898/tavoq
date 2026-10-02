// Functional check of the proxy's public-path predicate, executed against
// the REAL committed source in proxy.ts (not a copy of the array).
import { readFileSync } from "node:fs";

const src = readFileSync(process.argv[2] ?? "proxy.ts", "utf8");

// Extract the PUBLIC_PREFIXES array literal straight from the source.
const m = src.match(/const PUBLIC_PREFIXES\s*=\s*(\[[\s\S]*?\n\]);/);
if (!m) throw new Error("Could not locate PUBLIC_PREFIXES in proxy.ts");
const PUBLIC_PREFIXES = JSON.parse(
  m[1].replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*])/g, "$1")
);

// This mirrors the predicate in proxy(): exact match OR prefix + "/".
const isPublic = (pathname) =>
  PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const cases = [
  // [path, expectedPublic, description]
  ["/api/cron/daily-reminders", true, "Vercel Cron endpoint reaches handler"],
  ["/api/cron", true, "cron bare path"],
  ["/api/cron/anything-else", true, "future cron jobs"],
  ["/login", true, "login stays public"],
  ["/signup", true, "signup stays public"],
  ["/pending", true, "pending stays public"],
  ["/suspended", true, "suspended stays public"],
  ["/invite", true, "invite stays public"],
  ["/invite/abc123", true, "invite token stays public"],
  ["/auth/callback", true, "auth stays public"],
  ["/offline", true, "offline stays public"],
  ["/manifest.json", true, "manifest stays public"],
  ["/icons", true, "icons stay public"],
  ["/icons/x.png", true, "icon asset stays public"],
  ["/sw.js", true, "service worker stays public"],
  ["/api/push/subscribe", true, "push subscribe stays public"],
  ["/api/push/unsubscribe", true, "push unsubscribe stays public"],
  ["/api/cronx", false, "lookalike /api/cronx stays PROTECTED"],
  ["/api/cron-lookalike", false, "lookalike /api/cron-* stays PROTECTED"],
  ["/", false, "root stays protected"],
  ["/tasks", false, "tasks stays protected"],
  ["/tasks/123", false, "task detail stays protected"],
  ["/payments", false, "payments stays protected"],
  ["/profile", false, "profile stays protected"],
  ["/settings", false, "settings stays protected"],
  ["/projects", false, "projects stays protected"],
  ["/notifications", false, "notifications stays protected"],
  ["/admin", false, "admin stays protected"],
  // Pre-existing (not added by the cron fix): /api/push has always been a
  // public prefix; those routes authenticate independently.
  ["/api/push/other", true, "/api/push/* public pre-existing, unchanged"],
  ["/api/calendar/webhook", false, "google webhook stays protected"],
  ["/api/auth/google/callback", false, "google oauth callback stays protected"],
];

let failed = 0;
for (const [path, expected, desc] of cases) {
  const got = isPublic(path);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${path.padEnd(30)} public=${String(got).padEnd(5)} expected=${String(expected).padEnd(5)} ${desc}`
  );
}

console.log(`\n${cases.length - failed}/${cases.length} proxy predicate cases passed`);
if (failed) process.exit(1);