import { getUserProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";

export default async function DashboardPage() {
  let profile;

  try {
    profile = await getUserProfile();
  } catch (err) {
    console.error("Failed to load profile:", err);
    redirect("/login");
  }

  if (!profile) {
    redirect("/login");
  }

  if (profile.role === "ADMIN") {
    return <AdminDashboard profile={profile} />;
  }

  return <EmployeeDashboard profile={profile} />;
}
