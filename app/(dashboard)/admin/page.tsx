import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { requireAuth } from "@/lib/auth";

export default async function AdminPage() {
  const profile = await requireAuth();
  // MANAGER falls through to "/" — the same destination getAccountDestination
  // gives them at sign-in. Redirecting a manager to /employee instead used
  // to bounce them /admin -> /employee -> /admin forever, because /employee
  // sent every non-EMPLOYEE back here. Only an EMPLOYEE actually belongs on
  // that page, so only they are sent there.
  if (profile.role !== "SUPER_ADMIN") redirect("/dashboard");

  return <AdminDashboard firstName={profile.full_name.split(" ")[0]} />;
}