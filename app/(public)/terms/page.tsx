import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/constants";

export const metadata = {
  title: { absolute: "Taskora Terms of Service" },
  description: "The terms that govern your use of Taskora.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

const support = SUPPORT_EMAIL;

export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Taskora Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <p className="mt-8 text-sm text-muted-foreground">
        These Terms of Service govern your use of Taskora. By using the
        service, you accept these terms. This is not legal advice — if you
        need specific guidance, you should consult your own legal counsel.
      </p>

      <section className="mt-8 space-y-6 text-sm text-foreground">
        <h2 id="1">1. Use of Taskora</h2>
        <p>
          Taskora is a work management platform for teams and agencies. You
          agree to use the service only for lawful purposes and in accordance
          with these terms. You are responsible for all activity that happens
          through your account.
        </p>

        <h2 id="2">2. User accounts</h2>
        <p>
          You create and maintain an account, and you are responsible for
          keeping your credentials secure. You must provide accurate
          information and notify us of any changes. Accounts that are
          inactive for an extended period may be removed at our discretion.
        </p>

        <h2 id="3">3. Organization &amp; team access</h2>
        <p>
          Your organization controls which roles and teams may access the
          service. You are responsible for the conduct of your team members,
          and the organization owner is responsible for the overall
          operation of the workspace.
        </p>

        <h2 id="4">4. Employee access</h2>
        <p>
          Employees work within the tasks and projects assigned to them. A
          task belongs to the employee it is assigned to, and only staff may
          administer workspace settings. Employee access is limited to their
          own tasks and data.
        </p>

        <h2 id="5">5. Acceptable use</h2>
        <p>
          You agree not to use Taskora to transmit malicious code, violate
          any applicable law, harass other users, access data you are not
          entitled to, or interfere with the service or other users.
        </p>

        <h2 id="6">6. User responsibility</h2>
        <p>
          You are responsible for your use of Taskora. You will not upload
          content that violates the rights of others, and you will not use
          the service to store material that infringes copyright or
          otherwise violates these terms.
        </p>

        <h2 id="7">7. Task, project &amp; client data</h2>
        <p>
          Tasks, projects, clients, comments, and activity are your data and
          remain the property of your organization. You represent and
          warrant that you have the right to upload any content you add to
          the service. Nothing in these terms transfers ownership of your
          data to us.
        </p>

        <h2 id="8">8. Payment &amp; payout records</h2>
        <p>
          Payment and payout records are records of work. They are kept for
          accounting and audit purposes. If you need support with payouts,
          contact support at {support}.
        </p>

        <h2 id="9">9. Google Calendar integration</h2>
        <p>
          Google Calendar synchronization is a feature you may enable from
          your profile. When you connect your Google account, you grant the
          access described in our Privacy Policy, including the
          calendar.events scope. You agree that Taskora may create, update,
          and delete events on your primary calendar for your assigned tasks,
          and that you may disconnect at any time. We do not sell or share
          Google account or calendar data, and Google Calendar data is not
          used for any purpose other than this synchronization.
        </p>

        <h2 id="10">10. Third-party services</h2>
        <p>
          Taskora uses third-party services including Supabase, Vercel,
          Resend, and Google. These are governed by their own terms, and
          nothing in these terms changes your rights under their terms.
        </p>

        <h2 id="11">11. Availability</h2>
        <p>
          We aim to keep the service available, but we do not guarantee
          uninterrupted or error-free operation. We may schedule maintenance
          or make changes to the service at any time.
        </p>

        <h2 id="12">12. Security</h2>
        <p>
          We use reasonable security measures appropriate to the service,
          but we cannot guarantee the security or accuracy of your data.
          Security is a shared responsibility between the platform and your
          organization.
        </p>

        <h2 id="13">13. Intellectual property</h2>
        <p>
          Taskora and its trademarks are the property of Taskora and may not
          be used without permission. Your tasks, projects, and other content
          you upload remain yours, and we do not claim ownership of them.
        </p>

        <h2 id="14">14. Termination</h2>
        <p>
          We may terminate or suspend your account at any time for
          conduct that violates these terms. You may delete your account at
          any time. Some provisions survive termination, including the
          intellectual property and limitation of liability sections.
        </p>

        <h2 id="15">15. Data deletion</h2>
        <p>
          You may request deletion of your account and its data from the
          interface or by contacting support at {support}. We will delete
          your data in line with our ability to do so.
        </p>

        <h2 id="16">16. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Taskora will not be
          liable for indirect, incidental, or consequential damages arising
          from your use of the service. Our total liability is limited to
          the amounts you have paid us, if any.
        </p>

        <h2 id="17">17. Changes to the service</h2>
        <p>
          We may update the service, add features, or change how we operate.
          We will notify you of material changes. Your continued use of the
          service after changes take effect means you accept them.
        </p>

        <h2 id="18">18. Contact information</h2>
        <p>
          If you have any questions about these terms, contact us at{" "}
          <Link href={`mailto:${support}`}>{support}</Link>.
        </p>
      </section>
    </div>
  );
}
