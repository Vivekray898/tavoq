import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { getClient } from "@/lib/actions/clients";
import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/components/clients/client-form";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/projects");

  const { id } = await params;
  const result = await getClient(id);
  if (!result.success || !result.data) {
    redirect("/clients");
  }

  const client = result.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit client" />
      <ClientForm mode="edit" client={client} />
    </div>
  );
}
