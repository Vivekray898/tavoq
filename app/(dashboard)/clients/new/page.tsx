import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/components/clients/client-form";

export default async function NewClientPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/projects");

  return (
    <div className="space-y-6">
      <PageHeader title="Add client" />
      <ClientForm mode="create" />
    </div>
  );
}
