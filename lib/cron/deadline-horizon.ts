// Pure deadline-horizon logic for the daily reminder cron.
//
// Extracted from the route handler so it can be unit tested — an app/
// route is not importable by the node test runner, and this arithmetic
// is exactly the kind of thing that is wrong in a way nobody notices
// until a reminder fires on the wrong day.
/**
 * §71 — which reminder, if any, a deadline deserves today.
 *
 * Exactly one horizon is chosen, most urgent first, so a task that is
 * both "due tomorrow" and (by the time this runs) "overdue" produces one
 * message that is still true rather than two that contradict each other.
 *
 * Returns null for anything more than LOOKAHEAD_DAYS out: "due in 9
 * days" is not news, and a reminder people learn to ignore is worse
 * than no reminder.
 */
export type Horizon = "overdue" | "due_today" | "due_tomorrow" | "due_in_3_days";

export function classifyDeadline(deadline: string, todayIst: string): Horizon | null {
  const deadlineUtc = new Date(deadline).getTime();
  if (Number.isNaN(deadlineUtc)) return null;

  // Midnight IST at the start of today, as an instant.
  const todayStart = new Date(`${todayIst}T00:00:00+05:30`).getTime();
  const day = 24 * 60 * 60 * 1000;

  // Anything before today's start is overdue, however slightly.
  if (deadlineUtc < todayStart) return "overdue";

  const daysOut = Math.floor((deadlineUtc - todayStart) / day);
  if (daysOut === 0) return "due_today";
  if (daysOut === 1) return "due_tomorrow";
  if (daysOut <= 3) return "due_in_3_days";
  return null;
}

export const REMINDER_TITLES: Record<Horizon, string> = {
  overdue: "Task overdue",
  due_today: "Due today",
  due_tomorrow: "Due tomorrow",
  due_in_3_days: "Due in 3 days",
};

export const REMINDER_BODIES: Record<Horizon, string> = {
  overdue: "is past its deadline",
  due_today: "is due today",
  due_tomorrow: "is due tomorrow",
  due_in_3_days: "is due in 3 days",
};


