import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { EmployeesList } from "@/components/employees/employees-list";

export default async function EmployeesPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/tasks");

  return <EmployeesList />;
}
