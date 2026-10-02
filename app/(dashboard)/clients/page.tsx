import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { ClientsList } from "@/components/clients/clients-list";

export default async function ClientsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  // Staff-only surface: super admin or manager. Managers are
  // additionally scoped to their own projects inside the actions.
  if (profile.role !== "SUPER_ADMIN" && profile.role !== "MANAGER") redirect("/projects");

  return <ClientsList />;
}
