import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { startOfTodayIST } from "@/lib/utils";

/**
 * Daily reminder cron.
 *
 * Runs at 05:00 UTC (10:30 IST — see vercel.json). For every active
 * employee it finds assigned, unfinished tasks whose deadline is today
 * or already past, and sends one notification each.
 *
 * De-duplication: daily_reminder_log has a UNIQUE(user_id, task_id,
 * reminder_date), so a re-run or a manual retry can never double-notify
 * the same person about the same task on the same day.
 *
 * Authorization: Vercel sends `Authorization: Bearer $CRON_SECRET` on
 * every scheduled invocation. Without it anyone could trigger this
 * endpoint and spam the team.
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

  // Everything due up to the end of today, in any status that still
  // needs action.
  const dueCutoff = new Date(startOfTodayIST().getTime() + 24 * 60 * 60 * 1000).toISOString();

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

  // Already-notified pairs for today, so we skip them up front.
  const { data: alreadySent } = await supabase
    .from("daily_reminder_log")
    .select("user_id, task_id")
    .eq("reminder_date", reminderDate);

  const sent = new Set(
    ((alreadySent ?? []) as Array<{ user_id: string; task_id: string }>).map(
      (r) => `${r.user_id}:${r.task_id}`
    )
  );

  const notifications: Parameters<typeof createNotifications>[0] = [];
  const logRows: Array<{ user_id: string; task_id: string; reminder_date: string }> = [];
  let dueToday = 0;
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

    const key = `${raw.assigned_to}:${raw.id}`;
    if (sent.has(key)) continue;

    const isOverdue = new Date(raw.deadline).getTime() < Date.now();
    if (isOverdue) overdue += 1;
    else dueToday += 1;

    const projectName = Array.isArray(raw.project)
      ? raw.project[0]?.name
      : raw.project?.name;

    notifications.push({
      userId: raw.assigned_to,
      type: isOverdue ? "TASK_OVERDUE" : "TASK_DUE_SOON",
      title: isOverdue ? "Task overdue" : "Task due today",
      message: isOverdue
        ? `"${raw.title}" was due ${new Date(raw.deadline).toISOString().slice(0, 10)}${
            projectName ? ` · ${projectName}` : ""
          }`
        : `"${raw.title}" is due today${projectName ? ` · ${projectName}` : ""}`,
      referenceType: "task",
      referenceId: raw.id,
    });

    logRows.push({
      user_id: raw.assigned_to,
      task_id: raw.id,
      reminder_date: reminderDate,
    });
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
      .upsert(logRows, { onConflict: "user_id,task_id,reminder_date", ignoreDuplicates: true });
    if (logError) {
      console.error("[cron] reminder log", logError);
    }
  }

  console.log(
    `[cron] ${reminderDate} — ${notifications.length} reminders to ${employeeIds.length} employees (${dueToday} due today, ${overdue} overdue)`
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
    dueToday,
    overdue,
    staleWatchChannels: staleChannel,
    ranAt: nowIso,
  });
}
