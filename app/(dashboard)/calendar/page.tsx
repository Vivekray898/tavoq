import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { CalendarView } from "@/components/calendar/calendar-view";

/**
 * §71 — Calendar & notifications.
 *
 * Moved out of /profile, where the Google Calendar connection was buried
 * and so almost nobody ever connected it. Available to every role: an
 * employee syncing their own deadlines is the entire point.
 *
 * No role gate beyond being an active user with a profile — the page
 * only ever reads and writes the viewer's own calendar connection and
 * push subscriptions.
 */
export default async function CalendarPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.status !== "ACTIVE" || !profile.role) redirect("/pending");

  return <CalendarView />;
}