import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyDeadline,
  REMINDER_TITLES,
  REMINDER_BODIES,
  type Horizon,
} from "../lib/cron/deadline-horizon.ts";
import { getNavForRole, getNavItemsForRole } from "../lib/navigation.ts";

/**
 * §71 — Google Calendar sync + Web Push.
 *
 * The push plumbing, the service worker and the subscribe routes all
 * already existed, so most of what is asserted here is the *wiring*:
 * that every task mutation actually reaches the sync entry point, that a
 * device which has unsubscribed is deleted rather than retried forever,
 * and that the setup banner stays out of the way the moment either half
 * of the offer is connected.
 *
 * Source-level assertions strip comments first, so prose cannot satisfy
 * a structural rule.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// classifyDeadline — the arithmetic that decides which reminder fires
// ---------------------------------------------------------------------------

describe("classifyDeadline", () => {
  // todayIst is a plain calendar date; the function anchors on IST midnight.
  const t = (iso: string) => classifyDeadline(iso, "2026-10-03");

  test("exact IST midnight today is due_today, not overdue", () => {
    assert.equal(t("2026-10-03T00:00:00+05:30"), "due_today");
  });

  test("one instant before today is overdue", () => {
    assert.equal(t("2026-10-02T23:59:59+05:30"), "overdue");
  });

  test("later today is still due_today", () => {
    assert.equal(t("2026-10-03T18:30:00+05:30"), "due_today");
  });

  test("tomorrow is due_tomorrow", () => {
    assert.equal(t("2026-10-04T09:00:00+05:30"), "due_tomorrow");
  });

  test("three days out is the last horizon, four is not news", () => {
    assert.equal(t("2026-10-06T12:00:00+05:30"), "due_in_3_days");
    assert.equal(t("2026-10-07T00:00:01+05:30"), null);
  });

  test("unparseable deadlines yield null rather than a bogus reminder", () => {
    assert.equal(t("not-a-date"), null);
    assert.equal(t(""), null);
  });

  test("a far-past deadline is still just 'overdue', not a crash", () => {
    assert.equal(t("2020-01-01T00:00:00Z"), "overdue");
  });

  test("every horizon has a title and a body", () => {
    const horizons: Horizon[] = [
      "overdue",
      "due_today",
      "due_tomorrow",
      "due_in_3_days",
    ];
    for (const h of horizons) {
      assert.equal(typeof REMINDER_TITLES[h], "string", `title for ${h}`);
      assert.equal(typeof REMINDER_BODIES[h], "string", `body for ${h}`);
      assert.notEqual(REMINDER_TITLES[h], "");
      assert.notEqual(REMINDER_BODIES[h], "");
    }
  });
});

// ---------------------------------------------------------------------------
// B — assignee calendar sync
// ---------------------------------------------------------------------------

describe("syncAssigneeCalendar", () => {
  const gcal = () => strip(read("../lib/actions/google-calendar.ts"));

  test("no-ops on a null assignee instead of throwing", () => {
    const src = gcal();
    const fn = src.slice(src.indexOf("async function syncAssigneeCalendar"));
    assert.match(fn.slice(0, 200), /if \(!assigneeId\) return/);
  });

  test("returns early when the assignee never connected Google", () => {
    const src = gcal();
    const fn = src.slice(src.indexOf("async function syncAssigneeCalendar"));
    assert.match(
      fn.slice(0, 900),
      /loadTokenRow\(assigneeId\)[\s\S]*?if \(!row\) return/,
      "must bail before touching the network when there is no token row"
    );
  });

  test("swallows errors so a Google outage cannot fail a task mutation", () => {
    const src = gcal();
    const fn = src.slice(
      src.indexOf("async function syncAssigneeCalendar"),
      src.indexOf("async function syncSingleTaskForUser")
    );
    assert.match(fn, /catch \(err\)/);
    assert.match(fn, /console\.error/);
    // No rethrow anywhere in the body.
    assert.doesNotMatch(fn, /throw /);
  });

  test("a taskId narrows the work to one task; its absence means full reconcile", () => {
    const src = gcal();
    const fn = src.slice(src.indexOf("async function syncAssigneeCalendar"));
    assert.match(fn.slice(0, 1600), /if \(taskId\)[\s\S]*?syncSingleTaskForUser/);
    // The mode is resolved per user, so the full reconcile reaches the
    // right task set for whoever it is for.
    assert.match(fn.slice(0, 1600), /fullSyncForUser\(assigneeId, await calendarSyncModeForUserId\(assigneeId\)\)/);
  });

  test("the actor's own admin calendar is reconciled too", () => {
    // A SUPER_ADMIN's calendar is the work they assigned. Without this
    // their calendar would only ever update on a manual sync.
    const src = gcal();
    const fn = src.slice(src.indexOf("async function syncAssigneeCalendar"));
    assert.match(fn.slice(0, 3000), /actorId !== assigneeId/);
    assert.match(fn.slice(0, 3000), /actorMode === "admin_assignment"/);
    assert.match(fn.slice(0, 3000), /syncSingleTaskForUser\(actorId, actorRow, taskId, actorMode\)/);
  });

  test("removeCalendarEvent no-ops without a token row too", () => {
    const src = gcal();
    // Exported for nothing now — the task-delete path goes through
    // removeCalendarEventsForTask, which fans out over the mappings.
    // Match on the definition, not the longer sibling's name.
    const at = src.indexOf("async function removeCalendarEvent(");
    assert.ok(at > -1, "removeCalendarEvent not found");
    const fn = src.slice(at, at + 900);
    assert.match(fn, /if \(!userId\) return/);
    assert.match(fn, /if \(!row\) return/);
    assert.match(fn, /deleteEvent\(row, googleEventId, accessToken\)/);
  });

  test("deleting a task clears the event from every calendar holding it", () => {
    const src = gcal();
    const at = src.indexOf("export async function removeCalendarEventsForTask");
    assert.ok(at > -1, "removeCalendarEventsForTask not found");
    const fn = src.slice(at, src.indexOf("\n}", at));
    // A task lives on the assignee's calendar AND the creating admin's.
    // Clearing only one strands the other's event permanently, because
    // the mapping rows cascade away with the task.
    assert.match(fn, /from\(\s*"calendar_events"\s*\)[\s\S]*?\.eq\("task_id", taskId\)/);
    assert.match(fn, /for \(const mapping of rows\)/);
    // Each calendar is written with THAT user's own token.
    assert.match(fn, /removeCalendarEvent\(mapping\.user_id, mapping\.google_event_id\)/);
    // One user's calendar failing must not abort the rest.
    assert.match(fn, /catch \(err\) \{/);
  });
});

describe("a revoked Google grant fails cleanly instead of erroring forever", () => {
  const gcal = () => strip(read("../lib/actions/google-calendar.ts"));

  test("a permanently invalid refresh token is recorded, not erased", () => {
    // CHANGED IN PHASE 3. This previously asserted the row was DELETED.
    // Deleting it destroyed the evidence that the user had ever connected,
    // so the UI could only ever say "not connected" — sending them back
    // through consent for a problem they did not cause, with no way to
    // distinguish it from a first-time setup. Migration 024 adds
    // google_connections so the row survives with an explicit status.
    //
    // The requirement this test still guards is unchanged and important:
    // the sync must NOT keep retrying the dead grant forever.
    const src = gcal();
    assert.match(src, /PERMANENT_TOKEN_ERRORS/);
    assert.match(src, /invalid_grant/);
    const revoked = src.slice(src.indexOf("PERMANENT_TOKEN_ERRORS.has(json.error)"));
    const after = revoked.slice(0, 600);
    assert.match(after, /markNeedsReconnect/);
    // Still throws, so callers stop rather than looping.
    assert.match(after, /GoogleAuthRevokedError/);
    // ...and no longer erases the row on a failed refresh.
    assert.doesNotMatch(after, /user_google_tokens/);
  });

  test("an explicit disconnect still deletes the row", () => {
    // Opt-out is not failure: the user asked for this, so removing the
    // token is correct and must not be confused with a dead grant.
    const src = gcal();
    const fn = src.slice(src.indexOf("export async function disconnectGoogleCalendar"));
    assert.match(fn, /user_google_tokens/);
    assert.match(fn, /\.delete\(\)/);
  });

  test("permanent errors are distinguished from a transient Google outage", () => {
    // A network blip must NOT disconnect the user.
    const src = gcal();
    assert.match(
      src,
      /"invalid_grant",[\s\S]*?"invalid_client",[\s\S]*?"unauthorized_client"/
    );
  });

  test("fullSyncForUser RETURNS on a revoked grant rather than throwing", () => {
    // Three callers, two outside any try block. Throwing here was the bug.
    const src = gcal();
    const body = src.slice(
      src.indexOf("async function fullSyncForUser"),
      src.indexOf("async function fullSyncForUser") + 1400
    );
    assert.match(body, /if \(err instanceof GoogleAuthRevokedError\)/);
    assert.match(body, /return \{ success: false, error: err\.message \}/);
  });

  test("every getAccessToken call site sits inside a try", () => {
    // Regression guard: the original crash was an unguarded call whose
    // throw escaped as a 500. Checked per enclosing FUNCTION rather than
    // by line proximity, because a try may legitimately be far above.
    const src = gcal();
    const lines = src.split("\n");
    const offenders: string[] = [];
    let fnName = "(top level)";
    let fnStart = 0;

    lines.forEach((line, i) => {
      const fn = line.match(/^(?:export )?(?:async )?function (\w+)/);
      if (fn) {
        fnName = fn[1];
        fnStart = i;
      }
      if (!/getAccessToken\(/.test(line)) return;
      if (line.match(/^async function getAccessToken/)) return; // the definition
      // Look for a try between the start of this function and the call.
      const body = lines.slice(fnStart, i).join("\n");
      if (!/\btry \{/.test(body)) offenders.push(`${fnName}:${i + 1}`);
    });

    assert.deepEqual(
      offenders,
      [],
      `getAccessToken called with no enclosing try in: ${offenders.join(", ")}`
    );
  });

  test("a Google failure is never reported as Unauthorized", () => {
    // The bug: a revoked grant surfaced as "Unauthorized", sending the
    // user to the login page for a problem login cannot fix.
    const src = gcal();
    const fn = src.slice(
      src.indexOf("export async function syncAllTasksToCalendar"),
      src.indexOf("async function fullSyncForUser")
    );
    // The auth catch legitimately returns "Unauthorized". What must NOT
    // happen is the SYNC catch doing the same, so assert on the second
    // try/catch pair specifically.
    const syncCatch = fn.slice(fn.indexOf("catch (err)"));
    assert.doesNotMatch(syncCatch, /error: "Unauthorized"/);
    assert.match(fn, /GoogleAuthRevokedError/);
  });

  test("only requireAuth failures produce Unauthorized", () => {
    const src = gcal();
    const fn = src.slice(
      src.indexOf("export async function syncAllTasksToCalendar"),
      src.indexOf("async function fullSyncForUser")
    );
    // auth is isolated in its own try, sync in a second one
    assert.match(fn, /requireAuth\(\)[\s\S]*?userId = profile\.id/);
    assert.match(fn, /return \{ success: false, error: "Unauthorized" \}/);
  });
});

describe("a failed sync refreshes the connection status", () => {
  test("handleSync invalidates the cache on success AND failure", () => {
    // A revoked grant makes the server delete the token row. If the
    // status query is not invalidated on failure, the UI keeps showing
    // "connected" and the reconnect banner stays hidden.
    const src = strip(read("../components/calendar/calendar-view.tsx"));
    const fn = src.slice(
      src.indexOf("async function handleSync"),
      src.indexOf("async function handleDisconnect")
    );
    const invalidation = fn.indexOf("invalidateQueries");
    assert.ok(invalidation > -1, "handleSync must invalidate the status query");
    assert.ok(
      invalidation < fn.indexOf("if (res.success"),
      "invalidate before branching, so failures invalidate too"
    );
  });

  test("a cleared token row reports connected: false", () => {
    // The chain that makes the banner reappear: revoked -> row deleted
    // -> no row -> not connected -> banner shows.
    const src = strip(read("../lib/actions/google-calendar.ts"));
    const fn = src.slice(
      src.indexOf("export async function getGoogleCalendarStatus"),
      src.indexOf("export async function disconnectGoogleCalendar")
    );
    assert.match(fn, /loadTokenRow\(profile\.id\)/);
    assert.match(fn, /if \(!row\) \{[\s\S]*?connected: false/);
  });
});

describe("task mutations trigger calendar sync", () => {
  const src = () => strip(read("../lib/actions/tasks.ts"));

  test("exactly six mutation paths call a sync entry point", () => {
    const s = src();
    // The import is a bare `syncAssigneeCalendar,` with no paren, so every
    // `(` match is a real call site. Six: create, update x3 (previous
    // assignee, new assignee, and the actor's own admin calendar when
    // there was no reassignment), status, bulk.
    const calls = s.match(/syncAssigneeCalendar\(/g) ?? [];
    assert.equal(calls.length, 6, `expected 6 call sites, got ${calls.length}`);
  });

  test("creation syncs the new assignee and the creator's own calendar", () => {
    const s = src();
    const idx = s.indexOf("async function createTaskAction");
    const body = s.slice(idx, s.indexOf("async function", idx + 40));
    // The creator is passed so a SUPER_ADMIN's calendar — the work they
    // assigned — updates without waiting for a manual sync.
    assert.match(body, /syncAssigneeCalendar\(task\.assigned_to, task\.id, profile\.id\)/);
  });

  test("reassignment syncs the PREVIOUS assignee (full) and the new one (single)", () => {
    const s = src();
    const idx = s.indexOf("async function updateTaskAction");
    const body = s.slice(idx, s.indexOf("async function", idx + 40));
    assert.match(body, /syncAssigneeCalendar\(before\.assigned_to, undefined, profile\.id\)/);
    assert.match(body, /syncAssigneeCalendar\(task\.assigned_to, task\.id, profile\.id\)/);
  });

  test("a plain edit still refreshes the actor's own admin calendar", () => {
    // Without this, changing a deadline on a task the admin assigned to
    // somebody else would only reach that employee's calendar.
    const s = src();
    const idx = s.indexOf("async function updateTaskAction");
    const body = s.slice(idx, s.indexOf("async function", idx + 40));
    assert.match(
      body,
      /if \(!reassigned\) \{[\s\S]{0,200}?syncAssigneeCalendar\(profile\.id, task\.id, profile\.id\)/
    );
  });

  test("deletion removes the calendar event BEFORE the row is gone", () => {
    const s = src();
    const idx = s.indexOf("async function deleteTaskAction");
    const body = s.slice(idx, s.indexOf("async function", idx + 40));
    // Every calendar holding the task, not only the assignee's — the task
    // also lives on the calendar of whoever created it.
    const removeAt = body.indexOf("removeCalendarEventsForTask");
    assert.ok(removeAt > -1, "deleteTaskAction must call removeCalendarEventsForTask");
    assert.match(body.slice(removeAt - 200, removeAt + 200), /\.delete\(\)/);
    // removeCalendarEventsForTask must precede the delete() call in source order.
    assert.ok(
      removeAt < body.indexOf(".delete()"),
      "calendar event must be removed before the DB delete"
    );
  });

  test("status changes only sync when completion is entered or left", () => {
    const s = src();
    const idx = s.indexOf("async function updateTaskStatus");
    const body = s.slice(idx, s.indexOf("async function", idx + 40));
    assert.match(
      body,
      /status === "COMPLETED" \|\| previousStatus === "COMPLETED"/
    );
  });

  test("bulk updates sync each distinct assignee exactly once", () => {
    const s = src();
    const idx = s.indexOf("async function bulkUpdateTasks");
    const body = s.slice(idx, s.indexOf("async function", idx + 40));
    assert.match(body, /Set/);
    assert.match(body, /for \(const assigneeId of [\s\S]*?syncAssigneeCalendar\(assigneeId/);
    // No taskId in the bulk path — it reconciles whole calendars.
    assert.doesNotMatch(
      body.match(/syncAssigneeCalendar\(assigneeId[^)]*\)/)?.[0] ?? "",
      /taskId/, "bulk path should not pass a taskId"
    );
  });

  test("every sync call site is fire-and-forget, not awaited into the request", () => {
    const s = src();
    const awaited = s.match(/await syncAssigneeCalendar\(/g) ?? [];
    assert.equal(awaited.length, 0, "sync must not block the mutation");
  });
});

// ---------------------------------------------------------------------------
// C — push delivery
// ---------------------------------------------------------------------------

describe("sendPushToUser", () => {
  const push = () => strip(read("../lib/push.ts"));

  test("a gone subscription (404/410) is deleted, not retried forever", () => {
    const src = push();
    assert.match(src, /status === 404 \|\| status === 410/);
    const goneAt = src.indexOf("status === 404");
    const delAt = src.indexOf(".delete()", goneAt);
    assert.ok(delAt > goneAt, "the delete must follow the 404/410 check");
  });

  test("one failing device does not abort the others", () => {
    assert.match(push(), /Promise\.allSettled/);
  });

  test("unconfigured VAPID keys are a silent no-op, not a crash", () => {
    const src = push();
    const idx = src.indexOf("async function sendPushToUser");
    assert.ok(idx > -1);
    const body = src.slice(idx, idx + 2500);
    assert.match(body, /if \(!ensureConfigured\(\)\) return/);
  });

  test("every in-app notification also fires a push", () => {
    const src = strip(read("../lib/notifications.ts"));
    assert.match(src, /void sendPushToUser\(/);
  });
});

describe("payments notify over push", () => {
  const src = () => strip(read("../lib/actions/payments.ts"));

  test("payment-paid and adjustment paths both notify", () => {
    const s = src();
    assert.match(s, /function notifyPaymentPaid\(/);
    assert.match(s, /function notifyAdjustmentRecorded\(/);
    assert.match(s, /PAYMENT_PAID/);
  });

  test("notifications route through createNotification so push is inherited", () => {
    const s = src();
    const fn = s.slice(
      s.indexOf("function notifyPaymentPaid"),
      s.indexOf("function notifyAdjustmentRecorded")
    );
    assert.match(fn, /createNotification\(/);
  });

  test("batch marking notifies once per employee, not once per payment", () => {
    const s = src();
    const idx = s.indexOf("async function markPaymentsPaidBatch");
    const body = s.slice(idx, s.indexOf("async function", idx + 40));
    assert.match(body, /Set/);
  });
});

describe("service worker push handler", () => {
  // Phase 1 moved the worker from the hand-rolled public/sw.js to the Serwist
  // source at app/sw.ts. The push contract these assertions cover is unchanged,
  // so the assertions themselves are kept as-is — only the file under test moved.
  const sw = () => strip(read("../app/sw.ts"));

  test("handles push and notificationclick", () => {
    const src = sw();
    assert.match(src, /addEventListener\("push"/);
    assert.match(src, /addEventListener\("notificationclick"/);
  });

  test("tolerates a non-JSON payload", () => {
    const src = sw();
    const idx = src.indexOf('addEventListener("push"');
    const body = src.slice(idx, src.indexOf("});", idx));
    assert.match(body, /try \{[\s\S]*?event\.data\.json\(\)[\s\S]*?\} catch/);
  });

  test("falls back to a default url and titles", () => {
    const src = sw();
    const idx = src.indexOf('addEventListener("push"');
    const body = src.slice(idx, src.indexOf("});", idx));
    assert.match(body, /data\.title \|\| "Taskora"/);
    assert.match(body, /data\.url \|\| "\/notifications"/);
  });
});

// ---------------------------------------------------------------------------
// C — cron horizon and auth gate
// ---------------------------------------------------------------------------

describe("daily-reminders cron", () => {
  const src = () => strip(read("../app/api/cron/daily-reminders/route.ts"));

  test("unauthorized requests get a 401, never a redirect to /login", () => {
    const s = src();
    assert.match(s, /new Response\("Unauthorized", \{ status: 401 \}\)/);
    assert.doesNotMatch(s, /redirect\(/);
    assert.doesNotMatch(s, /NextResponse\.redirect/);
  });

  test("reuses the tested horizon module rather than re-deriving it", () => {
    assert.match(src(), /from "@\/lib\/cron\/deadline-horizon"/);
  });

  test("a three-day lookahead bounds the query window", () => {
    const s = src();
    assert.match(s, /const LOOKAHEAD_DAYS = 3/);
  });

  test("dedupe key and upsert conflict both include kind", () => {
    const s = src();
    assert.match(s, /\$\{r\.user_id\}:\$\{r\.task_id\}:\$\{r\.kind \?\? "PUSH"\}/);
    assert.match(
      s,
      /onConflict: "user_id,task_id,reminder_date,kind"/
    );
  });
});

// ---------------------------------------------------------------------------
// A / D — page, sidebar, profile cleanup, banner
// ---------------------------------------------------------------------------

describe("/calendar page", () => {
  test("exists and is reachable for every active role", () => {
    const src = strip(read("../app/(dashboard)/calendar/page.tsx"));
    assert.match(src, /getUserProfile\(\)/);
    assert.match(src, /redirect\("\/login"\)/);
    // No role gate: an employee must be able to reach their own calendar.
    assert.match(src, /profile\.status !== "ACTIVE"/);
    assert.doesNotMatch(src, /SUPER_ADMIN|ADMIN|EMPLOYEE/);
  });

  test("Calendar is reachable by every role, sidebar and drawer alike", () => {
    // Asserted behaviourally against getNavForRole rather than by counting
    // literals in the source: the nav config is now a single list, so a
    // second "/calendar" string no longer exists to count — and counting
    // strings could never have caught a role being filtered out.
    for (const role of ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as const) {
      const { desktop, mobile } = getNavForRole(role);
      const desktopHrefs = desktop.flatMap((s) => s.items).map((i) => i.href);
      const mobileHrefs = mobile.map((i) => i.href);
      assert.ok(desktopHrefs.includes("/calendar"), `${role} sidebar /calendar`);
      assert.ok(mobileHrefs.includes("/calendar"), `${role} drawer /calendar`);
    }
  });

  test("/profile no longer offers Google Calendar anywhere", () => {
    const src = read("../app/(dashboard)/profile/page.tsx");
    assert.doesNotMatch(src, /GoogleCalendarConnect/);
    assert.doesNotMatch(src, /google-calendar/);
    assert.doesNotMatch(src, /calendar/i);
  });
});

describe("setup banner", () => {
  const src = () => strip(read("../components/calendar/calendar-setup-banner.tsx"));

  test("dismissal is user-scoped with a 24h cooldown", () => {
    const s = src();
    assert.match(s, /taskora:setup-banner-dismissed:/);
    assert.match(s, /const COOLDOWN_MS = 24 \* 60 \* 60 \* 1000/);
  });

  test("hidden as soon as EITHER half is connected", () => {
    const s = src();
    assert.match(s, /if \(connected \|\| pushEnabled\) return null/);
    assert.match(s, /if \(dismissed\) return null/);
  });

  test("'subscribed' is the push state that counts — 'granted' is not", () => {
    assert.match(src(), /const pushEnabled = pushState === "subscribed"/);
  });

  test("is an external store, not a setState-in-effect cascade", () => {
    const s = src();
    assert.match(s, /useSyncExternalStore/);
    // The React 19 purity trap: a synchronous setState in an effect body
    // cascades a render on every mount. The cooldown is storage state, so
    // it must be read through the store.
    assert.doesNotMatch(s, /setState|useState/);
    assert.doesNotMatch(s, /useEffect/);
  });

  test("suppresses itself on the server/hydration pass, so it cannot flash", () => {
    const s = src();
    assert.match(s, /readDismissedOnServer/);
    const fn = s.slice(
      s.indexOf("const readDismissedOnServer"),
      s.indexOf("export function CalendarSetupBanner")
    );
    assert.match(fn, /=>\s*true\b/);
  });

  test("no render-time Date.now — the timestamp is compared once, in the store", () => {
    const s = src();
    const body = s.slice(
      s.indexOf("export function CalendarSetupBanner"),
      s.indexOf("function dismiss")
    );
    assert.doesNotMatch(
      body,
      /Date\.now\(\)/,
      "Date.now() during render makes the component non-idempotent"
    );
  });

  test("localStorage access is guarded (private mode must not crash it)", () => {
    const s = src();
    const fn = s.slice(
      s.indexOf("function readDismissed"),
      s.indexOf("function readDismissedOnServer")
    );
    assert.match(fn, /try \{/);
    assert.match(fn, /catch/);
  });

  test("an expired cooldown is cleared rather than accumulating", () => {
    assert.match(src(), /removeItem\(DISMISS_KEY\(userId\)\)/);
  });

  test("mounted on both dashboards", () => {
    for (const p of [
      "../components/dashboard/employee-dashboard.tsx",
      "../components/dashboard/admin-dashboard.tsx",
    ]) {
      assert.match(strip(read(p)), /CalendarSetupBanner/, `missing on ${p}`);
    }
  });

  test("never reads user_google_tokens from the browser", () => {
    assert.doesNotMatch(src(), /user_google_tokens/);
    assert.match(src(), /useGoogleCalendarStatus|getGoogleCalendarStatus|calendar/i);
  });
});

describe("migration 021", () => {
  const sql = () => read("../supabase/migrations/021_push_and_calendar_cleanup.sql");

  test("adds a kind column to both dedupe tables", () => {
    const s = sql();
    assert.match(
      s,
      /ALTER TABLE public\.push_subscriptions\s+ADD COLUMN IF NOT EXISTS kind TEXT/
    );
    assert.match(
      s,
      /ALTER TABLE public\.daily_reminder_log\s+ADD COLUMN IF NOT EXISTS kind TEXT/
    );
  });

  test("re-keys the unique index to include kind", () => {
    const s = sql();
    assert.match(
      s,
      /DROP CONSTRAINT IF EXISTS daily_reminder_log_user_id_task_id_reminder_date_key/
    );
    assert.match(
      s,
      /daily_reminder_log_uniq[\s\S]*?\(user_id, task_id, reminder_date, kind\)/
    );
  });

  test("ships a down migration and never weakens RLS", () => {
    const s = sql();
    assert.match(s, /DROP TABLE|drops? everything|DOWN/i);
    assert.doesNotMatch(s, /DROP POLICY/);
    assert.doesNotMatch(s, /DROP ROW LEVEL SECURITY/i);
  });
});