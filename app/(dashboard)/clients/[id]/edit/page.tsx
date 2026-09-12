"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/components/clients/client-form";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { ErrorMessage } from "@/components/shared/error-message";
import { getClient } from "@/lib/actions/clients";
import type { Client } from "@/types/database";

export default function EditClientPage() {
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const result = await getClient(clientId);
      if (result.success && result.data) {
        setClient(result.data);
      } else {
        setError(result.error || "Client not found");
      }
      setLoading(false);
    }
    load();
  }, [clientId]);

  if (loading) return <SkeletonPage />;
  if (error || !client) {
    return <ErrorMessage message={error || "Client not found"} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <PageHeader
          title={`Edit ${client.name}`}
          description="Update client information"
        />
      </div>
      <ClientForm client={client} mode="edit" />
    </div>
  );
}
