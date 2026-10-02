import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { SettingsForm } from "@/components/settings/settings-form";

export default async function SettingsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  // Settings are org configuration: super admin only. A manager who
  // navigates here directly is sent back to their work rather than
  // shown a half-broken form — matching the sidebar, which hides this
  // link for anyone but a super admin.
  if (profile.role !== "SUPER_ADMIN") redirect("/tasks");

  return <SettingsForm />;
}
