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
  if (profile.role !== "ADMIN") redirect("/tasks");

  const { id } = await params;
  return <EmployeeProfile employeeId={id} />;
}
