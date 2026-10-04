import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  shouldSendPush,
  buildDedupeKey,
  DEFAULT_PREFERENCES,
  type NotificationPreferences,
} from "../lib/push-preferences.ts";

/**
 * Phase 2 — Web Push delivery.
 *
 * The preference rules are asserted as behaviour, not as source text, because
 * "respect per-user notification preferences" is a correctness requirement:
 * a user who turns comments off must actually stop getting them.
 *
 * The remaining tests cover the wiring the pure module cannot see — that the
 * sender actually consults it, that the migration creates the schema, and that
 * every required trigger reaches createNotification.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  ...DEFAULT_PREFERENCES,
  ...over,
});

describe("preference gating", () => {
  test("a missing preferences row means everything on, not everything off", () => {
    // The single most damaging possible default: reading an absent row as
    // opt-out would silently disable notifications for every existing user the
    // first time this code ran.
    for (const input of [null, undefined]) {
      assert.equal(shouldSendPush(input, "COMMENT_ADDED"), true);
      assert.equal(shouldSendPush(input, "TASK_ASSIGNED"), true);
      assert.equal(shouldSendPush(input, "PAYMENT_PAID"), true);
    }
  });

  test("the master switch silences every channel", () => {
    const off = prefs({ push_enabled: false, comment_added: false });
    for (const type of [
      "TASK_ASSIGNED",
      "TASK_STATUS_CHANGED",
      "REVISION_REQUESTED",
      "COMMENT_ADDED",
      "PAYMENT_PAID",
      "TASK_DUE_SOON",
      "TASK_OVERDUE",
    ]) {
      assert.equal(shouldSendPush(off, type), false, `${type} should be blocked`);
    }
  });

  test("each channel toggle governs only its own notification types", () => {
    const onlyCommentsOff = prefs({ comment_added: false });
    assert.equal(shouldSendPush(onlyCommentsOff, "COMMENT_ADDED"), false);
    // Everything else must still get through.
    assert.equal(shouldSendPush(onlyCommentsOff, "TASK_ASSIGNED"), true);
    assert.equal(shouldSendPush(onlyCommentsOff, "PAYMENT_PAID"), true);
    assert.equal(shouldSendPush(onlyCommentsOff, "TASK_DUE_SOON"), true);
  });

  test("status_changed governs status changes and nothing else", () => {
    const off = prefs({ status_changed: false });
    assert.equal(shouldSendPush(off, "TASK_STATUS_CHANGED"), false);
    assert.equal(shouldSendPush(off, "TASK_ASSIGNED"), true);
  });

  test("an unknown future notification type is allowed, not dropped", () => {
    // A type added later must not start silently vanishing because nobody
    // added a mapping for it.
    assert.equal(shouldSendPush(prefs(), "SOME_FUTURE_TYPE"), true);
  });

  test("every notification_type enum value maps to a real channel", () => {
    // Guards the two drifting apart: the enum grows, the map must follow.
    const types = read("../types/database.ts");
    const block = types.slice(types.indexOf("export type NotificationType"));
    const values = [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    assert.ok(values.length >= 11, "expected the full enum");
    for (const value of values) {
      // Every declared type must either be mapped or explicitly allowed.
      assert.equal(typeof shouldSendPush(prefs(), value), "boolean", value);
    }
    // And the ones we care about must be genuinely gated.
    assert.equal(shouldSendPush(prefs({ comment_added: false }), "COMMENT_ADDED"), false);
    assert.equal(shouldSendPush(prefs({ payment_paid: false }), "PAYMENT_PAID"), false);
    assert.equal(shouldSendPush(prefs({ review_requested: false }), "REVISION_REQUESTED"), false);
  });
});

describe("dedupe keys", () => {
  const at = (iso: string) => new Date(iso);

  test("collapse a duplicate firing inside the same hour", () => {
    const a = buildDedupeKey("u1", "COMMENT_ADDED", "t1", at("2026-01-01T10:05:00Z"));
    const b = buildDedupeKey("u1", "COMMENT_ADDED", "t1", at("2026-01-01T10:59:00Z"));
    assert.equal(a, b, "the same event twice in one hour must collapse");
  });

  test("do NOT collapse a genuine later event on the same task", () => {
    // The reason the key is bucketed by hour rather than being permanent:
    // a second real comment hours later must still notify.
    const a = buildDedupeKey("u1", "COMMENT_ADDED", "t1", at("2026-01-01T10:05:00Z"));
    const b = buildDedupeKey("u1", "COMMENT_ADDED", "t1", at("2026-01-01T12:05:00Z"));
    assert.notEqual(a, b, "a later comment must still notify");
  });

  test("separate users, types, and references", () => {
    const now = at("2026-01-01T10:00:00Z");
    const base = buildDedupeKey("u1", "COMMENT_ADDED", "t1", now);
    assert.notEqual(base, buildDedupeKey("u2", "COMMENT_ADDED", "t1", now));
    assert.notEqual(base, buildDedupeKey("u1", "TASK_ASSIGNED", "t1", now));
    assert.notEqual(base, buildDedupeKey("u1", "COMMENT_ADDED", "t2", now));
  });

  test("tolerate a missing reference id", () => {
    const now = at("2026-01-01T10:00:00Z");
    const key = buildDedupeKey("u1", "X", null, now);
    assert.match(key, /^u1:X:none:/);
    assert.equal(key, buildDedupeKey("u1", "X", undefined, now));
  });

  test("is never unique-per-call, which would make dedupe a no-op", () => {
    // Regression guard. An earlier version keyed on the newly-inserted
    // notification's row id — unique on every call, so nothing was ever
    // suppressed and the log grew without deduping anything. Two identical
    // events in one hour MUST produce the same key.
    const a = buildDedupeKey("u1", "TASK_ASSIGNED", "t1", at("2026-01-01T10:00:00Z"));
    const b = buildDedupeKey("u1", "TASK_ASSIGNED", "t1", at("2026-01-01T10:30:00Z"));
    assert.equal(a, b, "dedupe must actually suppress duplicates");
  });
});

describe("sender wiring", () => {
  const push = () => strip(read("../lib/push.ts"));

  test("is server-only and never exposes the VAPID private key", () => {
    assert.match(push(), /^import "server-only";/);
    const src = read("../lib/push.ts");
    // The private key must only ever be read on the server.
    assert.match(src, /process\.env\.VAPID_PRIVATE_KEY/);
    // ...and never leaked into any payload.
    assert.doesNotMatch(src, /NEXT_PUBLIC_VAPID_PRIVATE_KEY/);
  });

  test("gates delivery on the user's preference for the notification type", () => {
    const src = push();
    assert.match(src, /loadPreferences/);
    assert.match(src, /shouldSendPush\(prefs, payload\.type\)/);
    // A missing type or force flag must not silently skip the check.
    assert.match(src, /!payload\.force && payload\.type/);
  });

  test("claims the dedupe key before sending, and skips on conflict", () => {
    const src = push();
    assert.match(src, /claimDedupeKey/);
    // 23505 is the unique-violation code that means "already delivered".
    assert.match(src, /23505/);
  });

  test("fans out to every device and filters to the WEB_PUSH channel", () => {
    const src = push();
    assert.match(src, /Promise\.allSettled/);
    assert.match(src, /\.eq\("kind", "WEB_PUSH"\)/);
  });

  test("stamps last_success_at only on a successful delivery", () => {
    const src = push();
    assert.match(src, /update\(\{ last_success_at:/);
    // The update must be inside the success path, after sendNotification.
    const sendIdx = src.indexOf("sendNotification");
    const stampIdx = src.indexOf("last_success_at");
    assert.ok(sendIdx > -1 && stampIdx > sendIdx, "stamp must follow the send");
  });

  test("deletes subscriptions the push service reports as gone", () => {
    const src = push();
    assert.match(src, /status === 404 \|\| status === 410/);
  });

  test("reports honestly when the manual test cannot be delivered", () => {
    const src = push();
    assert.match(src, /sendTestPushToUser/);
    // An unreachable device must not be reported as a success.
    assert.match(src, /delivered === 0/);
  });
});

describe("client push states", () => {
  const hook = () => strip(read("../lib/use-push.ts"));

  test("detects iOS including iPadOS masquerading as desktop", () => {
    const src = hook();
    assert.match(src, /iphone\|ipad\|ipod/i);
    assert.match(src, /MacIntel/);
  });

  test("distinguishes iOS browsers that can never do Web Push", () => {
    const src = hook();
    assert.match(src, /crios\|fxios|edgios|opios/i);
    assert.match(src, /unsupported-ios-browser/);
  });

  test("has a distinct state for iOS not added to the Home Screen", () => {
    const src = hook();
    assert.match(src, /ios-not-installed/);
    assert.match(src, /display-mode:\s*standalone/);
  });

  test("surfaces the reason a subscription failed instead of a silent no-op", () => {
    const src = hook();
    assert.match(src, /body\.error/);
    assert.match(src, /if \(reason\) toast\.error\(reason\)/);
  });

  test("still offers unsubscribe", () => {
    const src = hook();
    assert.match(src, /unsubscribe\(\)/);
    assert.match(src, /\/api\/push\/unsubscribe/);
  });

  test("the permission card renders every state with real guidance", () => {
    const src = strip(read("../components/notifications/push-permission-card.tsx"));
    for (const state of [
      "unsupported",
      "unsupported-ios-browser",
      "ios-not-installed",
      "denied",
      "subscribed",
      "granted",
    ]) {
      assert.match(src, new RegExp(`"${state}"`), `missing state ${state}`);
    }
    // The iOS guidance must be actionable, not just "not supported".
    assert.match(src, /Add to Home Screen/);
  });
});

describe("migration 023", () => {
  const sql = () => read("../supabase/migrations/023_push_delivery_and_preferences.sql");

  test("adds last_success_at to push_subscriptions", () => {
    assert.match(sql(), /push_subscriptions[\s\S]*?ADD COLUMN IF NOT EXISTS last_success_at/);
  });

  test("creates the preferences table with every channel defaulting on", () => {
    const s = sql();
    assert.match(s, /CREATE TABLE IF NOT EXISTS public\.notification_preferences/);
    for (const col of [
      "task_assigned",
      "status_changed",
      "review_requested",
      "comment_added",
      "payment_paid",
      "due_reminder",
      "push_enabled",
    ]) {
      assert.match(
        s,
        new RegExp(`${col} BOOLEAN NOT NULL DEFAULT TRUE`),
        `${col} must default to TRUE so nobody is silently opted out`
      );
    }
  });

  test("locks preferences to their owner with RLS", () => {
    const s = sql();
    assert.match(s, /notification_preferences ENABLE ROW LEVEL SECURITY/);
    assert.match(s, /USING \(user_id = auth\.uid\(\)\)/);
    assert.match(s, /WITH CHECK \(user_id = auth\.uid\(\)\)/);
  });

  test("creates a dedupe log enforced by a unique index", () => {
    const s = sql();
    assert.match(s, /CREATE TABLE IF NOT EXISTS public\.push_delivery_log/);
    assert.match(s, /CREATE UNIQUE INDEX IF NOT EXISTS push_delivery_log_uniq/);
    // The log is server bookkeeping; no user-facing policy.
    assert.match(s, /push_delivery_log ENABLE ROW LEVEL SECURITY/);
  });

  test("adds the status-change notification type without using it", () => {
    // Using an enum value in the same migration that adds it is Postgres
    // error 55P04; the repo's verify-migration-enum-order guard enforces this.
    // SQL comments use `--`, which the JS strip() helper does not remove, so
    // the header's prose about the value must not count as a use.
    const s = sql()
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(s, /ADD VALUE IF NOT EXISTS 'TASK_STATUS_CHANGED'/);
    const uses = [...s.matchAll(/'TASK_STATUS_CHANGED'/g)];
    assert.equal(uses.length, 1, "the value must be added and never re-used in SQL");
  });

  test("ships a down migration", () => {
    assert.match(sql(), /DOWN MIGRATION/);
  });
});

describe("triggers", () => {
  test("every required event routes through createNotification", () => {
    // createNotification is the only path that inserts AND pushes, so a
    // trigger that bypasses it silently produces no push.
    const files = {
      "lib/actions/tasks.ts": ["TASK_ASSIGNED", "TASK_STATUS_CHANGED", "REVISION_REQUESTED"],
      "lib/actions/comments.ts": ["COMMENT_ADDED"],
      "lib/actions/payments.ts": ["PAYMENT_PAID"],
      "app/api/cron/daily-reminders/route.ts": ["createNotifications"],
    };
    for (const [file, needles] of Object.entries(files)) {
      const src = read(`../${file}`);
      for (const needle of needles) {
        assert.ok(src.includes(needle), `${file} is missing ${needle}`);
      }
    }
  });

  test("status changes notify the assignee but skip richer dedicated events", () => {
    const src = strip(read("../lib/actions/tasks.ts"));
    assert.match(src, /type: "TASK_STATUS_CHANGED"/);
    // Notifying twice for one change is exactly the noise dedupe prevents.
    assert.match(src, /STATUS_CHANGE_NOTIFIED/);
    for (const status of ["SUBMITTED", "COMPLETED", "REVISION_REQUIRED"]) {
      assert.ok(src.includes(`"${status}"`), `${status} must be excluded`);
    }
  });

  test("the notification passes type and dedupe key to the sender", () => {
    const src = strip(read("../lib/notifications.ts"));
    assert.match(src, /type: input\.type,/);
    assert.match(src, /dedupeKey: buildDedupeKey\(/);
    // The reference (not a per-call row id) is what makes the key stable
    // enough to suppress a duplicate while still allowing a later one.
    assert.match(src, /buildDedupeKey\(input\.userId, input\.type, input\.referenceId\)/);
  });

  test("the test action authorizes and cannot target another user", () => {
    const src = strip(read("../lib/actions/notifications.ts"));
    assert.match(src, /getUserProfile\(\)/);
    assert.match(src, /sendTestPushToUser\(profile\.id\)/);
    // No userId parameter to tamper with.
    assert.doesNotMatch(src, /export async function sendTestPush\(userId/);
  });

  test("preference updates only write whitelisted boolean keys", () => {
    const src = strip(read("../lib/actions/notifications.ts"));
    assert.match(src, /const allowed: \(keyof NotificationPreferencesView\)\[\]/);
    assert.match(src, /typeof patch\[key\] === "boolean"/);
    // user_id must come from the session, never from the payload.
    assert.doesNotMatch(src, /clean\.user_id/);
  });

  test("preferences UI is reachable by every role, not just super admins", () => {
    // /settings is SUPER_ADMIN-only, so a per-user control placed there would
    // be invisible to employees.
    const page = read("../app/(dashboard)/notifications/page.tsx");
    assert.match(page, /NotificationPreferencesCard/);
    const settings = read("../app/(dashboard)/settings/page.tsx");
    assert.match(settings, /SUPER_ADMIN/, "settings is still admin-only");
  });
});

describe("push infrastructure intact", () => {
  test("subscribe/unsubscribe still authorize the caller", () => {
    for (const route of ["subscribe", "unsubscribe"]) {
      const src = read(`../app/api/push/${route}/route.ts`);
      assert.match(src, /auth\.getUser\(\)/, `${route} must authenticate`);
      assert.match(src, /401/, `${route} must reject anonymous callers`);
    }
  });

  test("the service worker still handles push and notificationclick", () => {
    const src = strip(read("../app/sw.ts"));
    assert.match(src, /addEventListener\("push"/);
    assert.match(src, /addEventListener\("notificationclick"/);
    // The click handler must focus an existing window before opening one.
    assert.match(src, /clients\.matchAll/);
    assert.match(src, /client\.focus\(\)/);
    assert.match(src, /clients\.openWindow/);
  });
});

describe("no client secret leakage", () => {
  test("the client hook only reads the PUBLIC vapid key", () => {
    const src = read("../lib/use-push.ts");
    assert.match(src, /NEXT_PUBLIC_VAPID_PUBLIC_KEY/);
    assert.doesNotMatch(src, /VAPID_PRIVATE_KEY/);
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE/);
  });

  test("the preferences action file keeps server-only imports server-side", () => {
    // These are "use server" actions, so nothing here may reach the bundle.
    // The directive need not be the very first line (this file has a leading
    // comment), so match it as a leading directive rather than with ^.
    const src = read("../lib/actions/notifications.ts");
    assert.match(src.trimStart(), /^(\/\/[^\n]*\n)*\s*"use server";/);
    assert.doesNotMatch(src, /NEXT_PUBLIC_VAPID_PRIVATE/);
  });

  test("the pure preference module stays importable on the client safely", () => {
    // It is imported by tests and by no client component; it must not pull in
    // server-only modules. Comments are stripped so this module's own prose
    // about being "free of server-only" cannot satisfy or fail the check.
    const src = strip(read("../lib/push-preferences.ts"));
    assert.doesNotMatch(src, /server-only/);
    assert.doesNotMatch(src, /@\/lib\/supabase/);
    assert.ok(existsSync(new URL("../lib/push-preferences.ts", import.meta.url)));
  });
});