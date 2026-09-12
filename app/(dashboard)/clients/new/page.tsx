import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/components/clients/client-form";

export default function NewClientPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New Client"
        description="Add a new client to your agency"
      />
      <ClientForm mode="create" />
    </div>
  );
}
