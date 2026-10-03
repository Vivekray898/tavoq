import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { startOfTodayIST } from "@/lib/utils";
import { classifyDeadline, REMINDER_TITLES, REMINDER_BODIES } from "@/lib/cron/deadline-horizon";

/**
 * Daily reminder cron — RECONCILIATION AND REMINDERS, NOT PRIMARY SYNC.
 *
 * Runs at 05:00 UTC (10:30 IST — see vercel.json).
 *
 * WHAT THIS IS *NOT*: the primary delivery mechanism. Since §71, task
 * mutations push an event to the assignee the moment they happen
 * (assignment, deadline edit, completion, payment), and Google Calendar
 * syncs inline. A phone gets the news in seconds.
 *
 * WHAT THIS IS: the safety net for everything the live path can miss.
 * Three concrete jobs:
 *
 *   1. Reminders on a horizon the live path cannot cover. Nobody edits a
 *      task to announce that "this is due in three days" — the passage of
 *      time is the event, so only a scheduled pass can react to it. Three
 *      horizons: due in 3 days, due tomorrow, overdue.
 *   2. Calendar reconciliation. An inline sync fired by a serverless
 *      invocation may be cut short when the function is frozen after the
 *      response is sent, and a sync attempted while a user's token was
 *      briefly invalid simply fails. Both leave drift that only this
 *      pass repairs.
 *   3. Watch-channel upkeep. Google caps push channels at 7 days; one
 *      expiring within a day is reported so it can be renewed.
 *
 * De-duplication: daily_reminder_log is unique on (user_id, task_id,
 * reminder_date, kind) after migration 021. `kind` distinguishes the
 * channels — a PUSH reminder and an EMAIL reminder are separate rows, so
 * enabling email does not suppress the push, while a second run the same
 * day is still a no-op.
 *
 * Authorization: Vercel sends `Authorization: Bearer $CRON_SECRET` on
 * every scheduled invocation. Without it anyone could trigger this
 * endpoint and spam the team, so an absent or wrong secret is a hard 401
 * — never a redirect, which would let a browser follow it to /login and
 * report the failure as a page load.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTIVE_STATUSES = ["TODO", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUIRED"];

/** "Today" in the user's timezone (IST), as a date string. */
function todayIst(): string {
  return startOfTodayIST().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();
  const reminderDate = todayIst();
  const nowIso = new Date().toISOString();

  // §71 — the window now reaches 3 days ahead, not just to end of today,
  // so a task can be warned about before it is due. Overdue tasks sit
  // below the window and are handled by the same query.
  const LOOKAHEAD_DAYS = 3;
  const dueCutoff = new Date(
    startOfTodayIST().getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: employees, error: empError } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "EMPLOYEE")
    .eq("status", "ACTIVE");

  if (empError) {
    console.error("[cron] load employees", empError);
    return NextResponse.json({ ok: false, error: "Failed to load employees" }, { status: 500 });
  }

  if (!employees || employees.length === 0) {
    return NextResponse.json({ ok: true, employees: 0, notified: 0 });
  }

  const employeeIds = employees.map((e) => e.id as string);

  // Super admins are also alerted about overdue work — an employee
  // silently slipping past a deadline is exactly the thing nobody
  // chases otherwise. Loaded once, used only on the overdue path.
  const { data: superAdmins } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "SUPER_ADMIN")
    .eq("status", "ACTIVE");
  const superAdminIds = new Set(
    ((superAdmins ?? []) as Array<{ id: string }>).map((a) => a.id)
  );

  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, status, deadline, assigned_to, project:projects(name)")
    .in("assigned_to", employeeIds)
    .in("status", ACTIVE_STATUSES)
    .not("deadline", "is", null)
    .lte("deadline", dueCutoff);

  if (taskError) {
    console.error("[cron] load tasks", taskError);
    return NextResponse.json({ ok: false, error: "Failed to load tasks" }, { status: 500 });
  }

  // Already-notified pairs for today, so we skip them up front. `kind`
  // is part of the key after migration 021, so a PUSH row never
  // suppresses a later EMAIL row for the same task.
  const { data: alreadySent } = await supabase
    .from("daily_reminder_log")
    .select("user_id, task_id, kind")
    .eq("reminder_date", reminderDate);

  const sent = new Set(
    ((alreadySent ?? []) as Array<{ user_id: string; task_id: string; kind: string }>).map(
      (r) => `${r.user_id}:${r.task_id}:${r.kind ?? "PUSH"}`
    )
  );

  const notifications: Parameters<typeof createNotifications>[0] = [];
  const logRows: Array<{
    user_id: string;
    task_id: string;
    reminder_date: string;
    kind: "PUSH";
  }> = [];
  let dueSoon = 0;
  let overdue = 0;

  for (const raw of (tasks ?? []) as unknown as Array<{
    id: string;
    title: string;
    status: string;
    deadline: string;
    assigned_to: string;
    project: { name: string }[] | { name: string } | null;
  }>) {
    if (!raw.assigned_to) continue;

    const key = `${raw.assigned_to}:${raw.id}:PUSH`;
    if (sent.has(key)) continue;

    const projectName = Array.isArray(raw.project)
      ? raw.project[0]?.name
      : raw.project?.name;

    // §71 — classify into the three horizons. A task gets exactly one
    // reminder per day even when several apply: "overdue" outranks
    // "due today", which outranks "due in N days", so the message is
    // always the most urgent true statement about the task.
    const horizon = classifyDeadline(raw.deadline, reminderDate);

    if (horizon === null) continue; // due in 4+ days: nothing to say yet
    if (horizon === "overdue") overdue += 1;
    else dueSoon += 1;

    notifications.push({
      userId: raw.assigned_to,
      type: horizon === "overdue" ? "TASK_OVERDUE" : "TASK_DUE_SOON",
      title: REMINDER_TITLES[horizon],
      message: `"${raw.title}" ${REMINDER_BODIES[horizon]}${
        projectName ? ` · ${projectName}` : ""
      }`,
      referenceType: "task",
      referenceId: raw.id,
    });

    logRows.push({
      user_id: raw.assigned_to,
      task_id: raw.id,
      reminder_date: reminderDate,
      kind: "PUSH",
    });

    // An overdue task is also the admin's problem, not just the
    // assignee's — nobody chases it otherwise. The extra notification is
    // written under the ADMIN's (user, task, day) key, so the same task
    // going overdue does not spam the assignee twice.
    if (horizon === "overdue" && superAdminIds.size > 0) {
      for (const adminId of superAdminIds) {
        const adminKey = `${adminId}:${raw.id}:PUSH`;
        if (sent.has(adminKey)) continue;
        sent.add(adminKey);
        notifications.push({
          userId: adminId,
          type: "TASK_OVERDUE",
          title: "Task overdue",
          message: `"${raw.title}" is past its deadline${projectName ? ` · ${projectName}` : ""}`,
          referenceType: "task",
          referenceId: raw.id,
        });
        logRows.push({
          user_id: adminId,
          task_id: raw.id,
          reminder_date: reminderDate,
          kind: "PUSH",
        });
      }
    }
  }

  if (notifications.length > 0) {
    const result = await createNotifications(notifications);
    if (!result.success) {
      console.error("[cron] createNotifications", result.error);
      return NextResponse.json({ ok: false, error: "Failed to send reminders" }, { status: 500 });
    }

    // Ignore a conflict here: it means a concurrent run won the race,
    // which is the outcome we wanted anyway.
    const { error: logError } = await supabase
      .from("daily_reminder_log")
      .upsert(logRows, { onConflict: "user_id,task_id,reminder_date,kind", ignoreDuplicates: true });
    if (logError) {
      console.error("[cron] reminder log", logError);
    }
  }

  console.log(
    `[cron] ${reminderDate} — ${notifications.length} reminders to ${employeeIds.length} employees (${dueSoon} due within ${LOOKAHEAD_DAYS} days, ${overdue} overdue)`
  );

  // Give calendar sync a nudge for anyone whose watch channel is close
  // to expiry (Google caps them at 7 days) or who has never synced.
  const { data: connected } = await supabase
    .from("user_google_tokens")
    .select("user_id, channel_expires_at, last_synced_at");

  const staleChannel = ((connected ?? []) as Array<{
    user_id: string;
    channel_expires_at: string | null;
    last_synced_at: string | null;
  }>).filter(
    (row) =>
      !row.channel_expires_at ||
      new Date(row.channel_expires_at).getTime() < Date.now() + 24 * 60 * 60 * 1000
  ).length;

  return NextResponse.json({
    ok: true,
    employees: employeeIds.length,
    notified: notifications.length,
    dueWithinLookahead: dueSoon,
    overdue,
    staleWatchChannels: staleChannel,
    ranAt: nowIso,
  });
}
