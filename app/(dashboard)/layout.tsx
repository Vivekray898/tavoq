import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/providers/session-provider";
import { NotificationsProvider } from "@/components/providers/notifications-provider";
import { RealtimeProvider } from "@/components/providers/realtime-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The profile gate is stated once, here, and each failure routes to a
  // page that explains itself. Nothing sends an authenticated user back to
  // /login: a null profile means either "no session" (→ /login, correct)
  // or "session but profile unreadable", and /login now renders a
  // diagnostic for that second case instead of re-offering sign-in — so
  // this redirect can no longer start a loop.
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.status === "SUSPENDED") redirect("/suspended");
  if (profile.status !== "ACTIVE" || !profile.role) redirect("/pending");

  const activeProfile = {
    ...profile,
    role: profile.role,
  } as typeof profile & { role: NonNullable<typeof profile.role> };

  return (
    <SessionProvider profile={activeProfile}>
      <RealtimeProvider userId={activeProfile.id}>
        <NotificationsProvider>
          <AppShell profile={activeProfile}>{children}</AppShell>
        </NotificationsProvider>
      </RealtimeProvider>
    </SessionProvider>
  );
}
