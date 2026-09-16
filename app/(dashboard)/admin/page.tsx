import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { requireAuth } from "@/lib/auth";

export default async function AdminPage() {
  const profile = await requireAuth();
  if (profile.role !== "ADMIN") redirect("/employee");

  return <AdminDashboard firstName={profile.full_name.split(" ")[0]} />;
}
