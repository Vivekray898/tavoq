import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { ClientsList } from "@/components/clients/clients-list";

export default async function ClientsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/projects");

  return <ClientsList />;
}
