import Link from "next/link";
import { OPERATOR_NAME, SUPPORT_EMAIL } from "@/lib/constants";

export const metadata = {
  title: { absolute: "Taskora Privacy Policy" },
  description:
    "How Taskora collects, uses, stores, and protects your data, including Google Calendar access.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

const support = SUPPORT_EMAIL;

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Taskora Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <section className="mt-8 space-y-6 text-sm text-foreground">
        <p>
          This Privacy Policy explains how <strong>Taskora</strong> — a
          professional work and task management platform for teams and
          agencies — collects, uses, stores, and shares information. It also
          covers the Google Calendar integration we offer.
        </p>

        <h2 id="1">1. Who operates Taskora</h2>
        <p>
          Taskora is operated by <strong>{OPERATOR_NAME}</strong>. Support and
          legal notices are sent to{" "}
          <Link href={`mailto:${support}`}>{support}</Link>. Everyone who signs
          in to Taskora is an account holder.
        </p>

        <h2 id="2">2. What Taskora is</h2>
        <p>
          Taskora is a work management platform. Employees create and
          organize tasks, projects, and clients; assign work by role; track
          deadlines; record payments and payouts; leave comments and see an
          activity timeline; search and filter; receive daily task reminders;
          and, optionally, sync assigned tasks to their personal Google
          Calendar.
        </p>

        <h2 id="3">3. What information Taskora processes</h2>
        <p>
          Taskora processes information you provide, information we receive
          from Google, and information your employees and your organization
          create as you use the service.
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li>Account and authentication information</li>
          <li>Employee, team, and organizational information</li>
          <li>Task, project, and client information</li>
          <li>Payment and payout information</li>
          <li>Notifications and activity information</li>
          <li>Google account and calendar information (where you connect Google Calendar)</li>
        </ul>

        <h2 id="4">4. Account &amp; authentication information</h2>
        <p>
          When you sign in, Taskora stores your account identifier and the
          profile details associated with it, including your name, email
          address, and role. Authentication is handled by <strong>Supabase
          Auth</strong> using secure, industry-standard credentials.
        </p>

        <h2 id="5">5. Employee &amp; team information</h2>
        <p>
          Team and organizational information includes the profiles of people
          in your organization, their roles, status, and availability. This
          information is only visible to people you designate as staff, and
          employee-level access is restricted to their own records. You can
          remove team members at any time.
        </p>

        <h2 id="6">6. Task, project &amp; client information</h2>
        <p>
          Task information includes titles, descriptions, statuses,
          priorities, labels, deadlines, assignments, comments, and activity
          history. Project information includes project metadata and
          resources. Client information includes client records and linked
          projects. This is the core data of your organization and the
          reason you use Taskora.
        </p>

        <h2 id="7">7. Payment &amp; payout information</h2>
        <p>
          Where available, Taskora records payment method, amount, currency,
          and status for payouts, including ledger records that track each
          payment against a task, project, and client. Recordkeeping and
          audit purposes.
        </p>

        <h2 id="8">8. Notifications &amp; activity information</h2>
        <p>
          Taskora processes notification preferences and delivery history, as
          well as activity logs that record who did what and when, to make
          sure the right people know about changes.
        </p>

        <h2 id="9">9. Google account information used for Google Calendar integration</h2>
        <p>
          To enable calendar synchronization, an employee grants Taskora
          access to their own Google account. Taskora uses the email address
          returned by Google as the label for the connected account.
        </p>

        <h2 id="10">10. Google Calendar data accessed by Taskora</h2>
        <p>
          When calendar synchronization is enabled, Taskora reads a change
          list from the <strong>user&apos;s primary Google Calendar</strong> and
          searches it for events that Taskora created. This is how Taskora
          detects when a user deletes an event in Google so that the matching
          task mapping can be cleared. Google Calendar data is not read into
          tasks, and Taskora does not look at any other calendar or any data
          that is not part of this synchronization.
        </p>

        <h2 id="11">11. Why Google Calendar data is accessed</h2>
        <p>
          It is accessed only to keep your assigned tasks visible on your
          Google Calendar. Every event Taskora creates, updates, or deletes
          is tagged with the originating task id, so Taskora can identify and
          maintain its own events.
        </p>

        <h2 id="12">12. How Google Calendar data is used</h2>
        <p>
          The only Google Calendar operations performed are: creating events
          from assigned tasks, updating those events when the task changes,
          and deleting events when the underlying task is removed or the
          user deletes the event in Google. Webhook change notifications are
          processed and then discarded immediately.
        </p>

        <h2 id="13">13. Whether Google Calendar data is shared</h2>
        <p>
          Google Calendar data is not shared with any third party for any
          purpose other than the synchronization that the user has requested.
A user&apos;s tasks, comments, and other data such as their name, email,
          and files that Taskora processes are never sold or shared with
          third parties for advertising or similar purposes.
        </p>

        <h2 id="14">14. Whether Google Calendar data is sold</h2>
        <p>
          No. Taskora does not sell Google Calendar data, Google account
          data, or any Taskora user data. Taskora uses infrastructure that
          may be provided by third parties, including Supabase, Vercel,
          Resend, and Google, and these providers may process the data in
          accordance with their own agreements with Taskora, and their
          privacy documentation applies.
        </p>

        <h2 id="15">15. How Google Calendar credentials &amp; tokens are protected</h2>
        <p>
          Google credentials and refresh tokens are never stored in your
          browser. A refresh token is encrypted at rest using AES-256-GCM
          with a server-side encryption key before it is written to the
          database. Access tokens are short-lived and are not stored
          indefinitely.
        </p>

        <h2 id="16">16. Token encryption at rest</h2>
        <p>
          Yes. Refresh tokens are encrypted at rest with AES-256-GCM in the
          format <code>v1:&lt;iv&gt;:&lt;tag&gt;:&lt;ciphertext&gt;</code>.
          The encryption key is held only in the secure server environment.
          On disconnect, the encrypted token is deleted. Google access is
          revoked server-side and the stored connection is deleted.
        </p>

        <h2 id="17">17. Data retention</h2>
        <p>
          Taskora keeps the data necessary to operate the service,
          including invoicing and audit. Your organization can delete its
          account at any time, which deletes all of its data. There is no
          automatic data retention schedule beyond what is necessary to
          operate the service.
        </p>

        <h2 id="18">18. User controls</h2>
        <p>
          You control your account and its data through the Taskora
          interface, including account settings, notification preferences,
          and, for the calendar integration, the Google Calendar section of
          your profile. You may connect to, reconnect, and disconnect your
          Google account at any time.
        </p>

        <h2 id="19">19. How to disconnect Google Calendar</h2>
        <p>
          Open your profile, go to <strong>Google Calendar</strong>, and
          select <strong>Disconnect</strong>. Taskora revokes its access at
          Google and deletes the stored token and connection. Your work in
          Taskora is not affected.
        </p>

        <h2 id="20">20. Account &amp; data deletion process</h2>
        <p>
          You can request that your account and team be deleted from the
          Taskora interface or contact support at {support}. Your data will
          be removed in line with our ability to delete it, which we will
          confirm when you submit the request.
        </p>

        <h2 id="21">21. Security practices</h2>
        <p>
          Taskora keeps your data secure using industry-standard practices.
          Authentication is handled by Supabase Auth, database access is
          protected by row-level security, tokens at rest are encrypted, and
          all supported connections are HTTPS. No security practice is
          perfect, and we cannot guarantee that your data is never
          compromised.
        </p>

        <h2 id="22">22. Third-party services used</h2>
        <p>
          The following third-party services are used, and each may process
          data in accordance with its own privacy documentation:
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li><strong>Supabase</strong> — authentication, database storage, realtime, and storage</li>
          <li><strong>Vercel</strong> — hosting and scheduled jobs</li>
          <li><strong>Google Calendar API</strong> — calendar synchronization you request</li>
          <li><strong>Resend</strong> — transactional email</li>
          <li><strong>Web Push / VAPID</strong> — browser push notifications</li>
        </ul>

        <h2 id="23">23. Supabase usage</h2>
        <p>
          Taskora is built on Supabase. Supabase Auth handles sign-in and
          session management, Supabase Postgres hosts your data, rows are
          protected by row-level security, and Storage and Realtime are used
          for file attachments and live updates. Supabase does not sell your
          data.
        </p>

        <h2 id="24">24. Vercel hosting</h2>
        <p>
          Taskora is hosted on Vercel. Hosting infrastructure is where our
          application runs and may be a party to processing of your data
under Vercel&apos;s privacy terms.
        </p>

        <h2 id="25">25. Google APIs / Google Calendar API</h2>
        <p>
          Taskora uses the Google Calendar API with the
          <code className="text-xs">calendar.events</code> scope, under the
Google API terms and Google&apos;s API services User Data Policy.
        </p>

        <h2 id="26">26. Contact &amp; support information</h2>
        <p>
          For support, privacy questions, or requests, contact us at{" "}
          <Link href={`mailto:${support}`}>{support}</Link>.
        </p>

        <h2 id="27">27. Policy update procedure</h2>
        <p>
          We may update this Privacy Policy from time to time. Material
          changes will be flagged on this page with a new effective date.
          Continued use of the service after a change takes effect means you
          accept the updated policy.
        </p>
      </section>
    </div>
  );
}
