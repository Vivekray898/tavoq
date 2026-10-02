import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/components/clients/client-form";

export default async function NewClientPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  // Staff-only surface: super admin or manager. Managers are
  // additionally scoped to their own projects inside the actions.
  if (profile.role !== "SUPER_ADMIN" && profile.role !== "MANAGER") redirect("/projects");

  return (
    <div className="space-y-6">
      <PageHeader title="Add client" />
      <ClientForm mode="create" />
    </div>
  );
}
