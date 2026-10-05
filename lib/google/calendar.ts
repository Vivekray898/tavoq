/**
 * Pure builders for the Google Calendar integration.
 *
 * These live apart from lib/actions/google-calendar.ts on purpose. The
 * action module is `"use server"` and imports next/headers, the
 * Supabase clients and the auth helpers, so nothing in it can be
 * loaded by the test runner. The two pieces with real logic worth
 * pinning down — the authorize URL parameters and the event payload
 * Google will accept — are extracted here so they can be tested
 * directly instead of being asserted on as source text.
 *
 * Nothing in this file performs I/O.
 */

/** Trailing slashes must not leak into the redirect_uri. */
export function normalizeAppUrl(raw: string | undefined): string {
  return (raw || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * The OAuth callback path, which Google must have registered exactly.
 *
 * The origin is normalised here as well as at the call site: a
 * trailing slash produces a double slash, and a double slash is a
 * `redirect_uri_mismatch` at the token exchange — a failure that
 * presents as a generic "Couldn't connect".
 */
export function callbackRedirectUri(appUrl: string): string {
  return `${normalizeAppUrl(appUrl)}/api/auth/google/callback`;
}

/**
 * Parameters for the consent screen.
 *
 * `access_type=offline` and `prompt=consent` are load-bearing, not
 * decoration. Without them Google returns a refresh token only on the
 * very first authorisation, so a user who revoked and reconnected
 * would silently get an access token that dies in an hour and the sync
 * would stop with nothing in the logs. `include_granted_scopes` keeps
 * previously granted scopes when the list grows.
 */
export function buildAuthorizeParams({
  clientId,
  redirectUri,
  scopes,
  state,
}: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
}


/**
 * The calendar's default timezone.
 *
 * Taskora is an agency tool with work deadlines that people read as local
 * wall-clock dates, so an event must land on the same calendar day the user
 * typed — not the same day in UTC.
 */
export const CALENDAR_TIME_ZONE = "Asia/Kolkata";

/**
 * The calendar DATE (YYYY-MM-DD) on which an instant falls, in the given
 * timezone.
 *
 * This exists because `toISOString().slice(0, 10)` is wrong for any timezone
 * with a positive offset, and IST is UTC+5:30. A deadline of
 * 2026-03-10T02:00+05:30 is 2026-03-10 in Kolkata but 2026-03-09T20:30Z in
 * UTC — so slicing the ISO string put the event a day early for every task
 * due before 05:30 IST. Formatting in the target zone is the fix.
 */
export function toCalendarDate(instant: Date, timeZone = CALENDAR_TIME_ZONE): string {
  // en-CA renders ISO-shaped YYYY-MM-DD, but the parts are read explicitly so
  // the output does not depend on locale data.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Add whole days to a YYYY-MM-DD calendar date without touching the clock. */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** RFC3339 with the calendar's UTC offset, for timed events. */
export function toZonedDateTime(
  instant: Date,
  timeZone = CALENDAR_TIME_ZONE
): string {
  // Google's API accepts an offset-qualified timestamp. Render it in the
  // target zone so the wall-clock time matches what the user expects.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Kolkata is UTC+05:30 with no DST, so a fixed offset is exact here.
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+05:30`;
}

/**
 * Exponential backoff for a transient Google API failure.
 *
 * Only transport errors and 5xx/429 are worth retrying: a 4xx like
 * `invalid_grant` or 404 will fail identically every time, and retrying it
 * hides the real problem. `shouldRetry` decides, this decides how long to wait.
 */
export function backoffDelayMs(attempt: number, baseMs = 500, maxMs = 8000): number {
  const delay = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(delay, maxMs);
}

/** True when a status code represents a transient failure worth retrying. */
export function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export interface SyncableTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  project_id: string;
  /**
   * Global to the task, NOT per user. With two calendars holding the same
   * task it holds whichever id was written last, so sync must resolve a
   * user's event through calendar_events rather than read this. Read here
   * only as a legacy fallback for rows predating that table.
   */
  google_event_id: string | null;
  /** Who put the work in motion — the admin-assignment sync's filter. */
  created_by?: string | null;
  assigned_to?: string | null;
  project?: { name: string; client?: { name: string } | null } | null;
}

/**
 * The event body sent to calendar.events.insert / .update.
 *
 * Two rules Google enforces strictly:
 *  • An all-day event needs `start.date` / `end.date` as YYYY-MM-DD
 *    strings, never ISO timestamps — sending `dateTime` there is a 400.
 *  • `end` is exclusive, so an all-day event on the 3rd ends on the 4th.
 *
 * A task with no deadline cannot become an all-day event, so it falls
 * back to a one-hour timed event starting now rather than being sent
 * with an undefined start (which Google also rejects).
 */
export function buildEventBody(task: SyncableTask): Record<string, unknown> {
  const projectName = task.project?.name ?? "";
  const clientName = task.project?.client?.name ?? "";

  const descriptionLines = [
    task.description?.trim() || "",
    projectName ? `Project: ${projectName}` : "",
    clientName ? `Client: ${clientName}` : "",
    `Priority: ${task.priority}`,
    `Status: ${task.status}`,
    `Taskora task id: ${task.id}`,
  ].filter(Boolean);

  const body: Record<string, unknown> = {
    summary: task.title,
    description: descriptionLines.join("\n"),
    // The task id is stable, so re-running sync updates in place
    // instead of creating duplicate events.
    extendedProperties: { private: { taskoraTaskId: task.id } },
    timeZone: CALENDAR_TIME_ZONE,
  };

  const deadline = task.deadline ? new Date(task.deadline) : null;

  if (deadline && !isNaN(deadline.getTime())) {
    // All-day events use an exclusive end date. Both dates are derived in
    // the calendar timezone rather than UTC — see toCalendarDate.
    const day = toCalendarDate(deadline);
    body.start = { date: day };
    body.end = { date: addCalendarDays(day, 1) };
  } else {
    // No deadline, or one that does not parse. Both used to leave the
    // body without a `start` at all — an invalid date fell through the
    // if/else rather than reaching the fallback — and Google answers
    // that with a 400 that arrived as an invisible per-task error.
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    body.start = { dateTime: toZonedDateTime(start), timeZone: CALENDAR_TIME_ZONE };
    body.end = { dateTime: toZonedDateTime(end), timeZone: CALENDAR_TIME_ZONE };
  }

  return body;
}