import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CalendarDays, CheckCircle, Users, FolderKanban, Building2 } from "lucide-react";

export const metadata = {
  title: {
    absolute: "Taskora — Team Task & Project Management",
  },
  description:
    "Taskora is a professional team work management platform for agencies. Organize tasks, projects, and clients, assign work, track deadlines, and manage payouts — with Google Calendar synchronization so your assigned tasks stay visible on your calendar.",
  alternates: {
    canonical: "/",
  },
  robots: { index: true, follow: true },
};

export default function LandingPage() {
  return (
    <div>
      {/* ── Hero ── */}
      <section className="rounded-2xl bg-gradient-to-b from-primary to-primary/80 px-6 py-12 text-primary-foreground sm:px-12 sm:py-16">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Taskora — Team Task & Project Management
            </h1>
            <p className="mt-3 max-w-xl text-sm text-primary-foreground/85 sm:text-base">
              A professional work and task management platform for teams and
              agencies. Organize tasks, projects, and clients — assign work,
              track deadlines, and manage payouts, with Google Calendar
              synchronization so your assigned tasks stay visible on your
              calendar.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" render={<Link href="/dashboard" />}>
              Open dashboard
            </Button>
            <Button size="sm" variant="outline" render={<Link href="/login" />}>
              Sign in
            </Button>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Everything your team needs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Taskora covers the full workflow — boards, tables, calendars, and a
          task calendar that mirrors your work into Google Calendar.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: CheckCircle, title: "Task management", desc: "Create, organize, and track tasks across five statuses with labels, priorities, and subtasks." },
            { icon: FolderKanban, title: "Project management", desc: "Organize work into projects with phases, resources, and per-project settings." },
            { icon: Building2, title: "Client management", desc: "Track clients, their projects, and the work tied to each." },
            { icon: Users, title: "Employee & team management", desc: "Invite people, approve accounts, and assign work by role." },
            { icon: CheckCircle, title: "Task assignment", desc: "Assign tasks to employees and reassign as workloads change." },
            { icon: CalendarDays, title: "Task deadlines", desc: "Deadlines on every task, with daily reminders and a deadline horizon." },
            { icon: CheckCircle, title: "Payment & payout tracking", desc: "Record payouts and match them to tasks, projects, and clients." },
            { icon: CheckCircle, title: "Notifications", desc: "In-app, push, and email notifications keep the team in sync." },
            { icon: CheckCircle, title: "Comments & activity", desc: "Comment on tasks and follow the full activity timeline." },
            { icon: CheckCircle, title: "Search & filtering", desc: "Find anything instantly with global search and advanced filtering." },
            { icon: CalendarDays, title: "Google Calendar synchronization", desc: "Assigned tasks mirror onto your Google Calendar, and you can reconnect anytime." },
            { icon: CheckCircle, title: "Daily task reminders", desc: "A daily pass surfaces what is due in three, tomorrow, and overdue." },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <item.icon className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Google Calendar integration ── */}
      <section className="mt-12 rounded-2xl border bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:items-start">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Google Calendar integration</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Why Taskora asks for calendar access, what it does with it, and
              how to control it.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-medium">Why this permission is needed</h3>
            <p className="mt-1 text-sm text-muted-foreground">
Taskora writes events onto the signed-in user&apos;s own Google
              Calendar so that every task assigned to them stays visible
              without opening the app. The events are created, updated, and
              deleted only by Taskora, are tagged with the originating task
              id, and fall on the calendar day the user actually typed.
              Connecting happens once — the consent screen is shown again
              only if access expires or is revoked.
            </p>
          </div>
          <div>
            <h3 className="font-medium">What it can do</h3>
            <ul className="mt-1 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Employees connect their own Google account from their profile.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Taskora creates, updates, and deletes events for assigned
tasks on the user&apos;s primary calendar.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                When a task is edited, its calendar event updates in place so
                the two stay current.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Google Calendar push notifications are watched so deletions in
                Google clear the matching task mapping.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-medium">What it cannot do</h3>
            <ul className="mt-1 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Access other calendars, attendee information, or calendar
                settings.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Read or import event content from Google into a task.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Use the calendar data for anything other than this
                task-to-event sync.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Sell or share Google user data for any purpose.
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Important limitations</h3>
            <ul className="mt-1 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                Taskora remains the source of truth for task fields. Editing
                an event in Google does not change the task it came from.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                The sync only covers the primary calendar and the events
                Taskora created.
              </li>
              <li className="flex gap-2">
                <CheckCircle className="size-4 text-primary shrink-0" />
                If access expires, reconnect from your profile to resume.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:justify-content:center">
          <Button variant="outline" size="sm" render={<Link href="/dashboard" />}>
            Open the calendar page
          </Button>
          <Button size="sm" render={<Link href="/dashboard" />}>
            Connect Google Calendar
          </Button>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { num: "1", title: "Create tasks", desc: "Tasks, projects, and clients are organized the way your agency works." },
            { num: "2", title: "Assign to the team", desc: "Assign by role, set deadlines, and track status in real time." },
            { num: "3", title: "Sync to the calendar", desc: "Each employee connects Google Calendar from their profile and assigned tasks land on their calendar." },
          ].map((step) => (
            <div key={step.num} className="rounded-xl border bg-card p-5 text-center">
              <p className="text-2xl font-semibold text-primary">{step.num}</p>
              <p className="mt-2 font-medium">{step.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
