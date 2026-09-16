import { redirect } from "next/navigation";
import { requireAuthenticatedProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationsProvider } from "@/components/providers/notifications-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireAuthenticatedProfile().catch(() => null);
  if (!profile) redirect("/login");
  if (profile.status === "PENDING" || !profile.role) redirect("/pending");
  if (profile.status === "SUSPENDED") redirect("/suspended");

  const activeProfile = {
    ...profile,
    role: profile.role,
  } as typeof profile & { role: NonNullable<typeof profile.role> };

  return (
    <NotificationsProvider userId={activeProfile.id}>
      <AppShell profile={activeProfile}>{children}</AppShell>
    </NotificationsProvider>
  );
}
