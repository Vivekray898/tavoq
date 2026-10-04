import { redirect } from "next/navigation";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { requireAuth } from "@/lib/auth";

export default async function EmployeePage() {
  const profile = await requireAuth();
  // Anyone who is not an employee goes to "/" rather than to /admin.
  // /admin redirects every non-super-admin back to "/", so aiming here
  // would send a manager in a loop between the two pages.
  if (profile.role !== "EMPLOYEE") redirect("/dashboard");

  return <EmployeeDashboard firstName={profile.full_name.split(" ")[0]} />;
}
