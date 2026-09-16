import { getUserProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";

export default async function DashboardPage() {
  const profile = await getUserProfile();
  if (!profile) {
    redirect("/login");
  }

  if (profile.role === "ADMIN") {
    return <AdminDashboard firstName={profile.full_name.split(" ")[0]} />;
  }

  return <EmployeeDashboard firstName={profile.full_name.split(" ")[0]} />;
}
