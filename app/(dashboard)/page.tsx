import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";

export default async function DashboardPage() {
  const profile = await getUserProfile();
  if (!profile) {
    redirect("/login");
  }

  // Defense in depth — proxy.ts already gates these states, but this
  // page must never render a workspace for a pending/suspended account.
  if (profile.status !== "ACTIVE" || !profile.role) {
    redirect(profile.status === "SUSPENDED" ? "/suspended" : "/pending");
  }

  if (profile.role === "ADMIN") {
    return <AdminDashboard firstName={profile.full_name.split(" ")[0]} />;
  }

  return <EmployeeDashboard firstName={profile.full_name.split(" ")[0]} />;
}
