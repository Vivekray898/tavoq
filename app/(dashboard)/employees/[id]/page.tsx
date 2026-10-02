import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { EmployeeProfile } from "@/components/employees/employee-profile";

export default async function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  // Staff-only surface: super admin or manager. Managers are
  // additionally scoped to their own projects inside the actions.
  if (profile.role !== "SUPER_ADMIN" && profile.role !== "MANAGER") redirect("/tasks");

  const { id } = await params;
  return <EmployeeProfile employeeId={id} />;
}
