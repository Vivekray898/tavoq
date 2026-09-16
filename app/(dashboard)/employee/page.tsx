import { redirect } from "next/navigation";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { requireAuth } from "@/lib/auth";

export default async function EmployeePage() {
  const profile = await requireAuth();
  if (profile.role !== "EMPLOYEE") redirect("/admin");

  return <EmployeeDashboard firstName={profile.full_name.split(" ")[0]} />;
}
