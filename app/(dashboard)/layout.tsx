import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationsProvider } from "@/components/providers/notifications-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getUserProfile();
  if (!profile) {
    redirect("/login");
  }

  return (
    <NotificationsProvider userId={profile.id}>
      <AppShell profile={profile}>{children}</AppShell>
    </NotificationsProvider>
  );
}
