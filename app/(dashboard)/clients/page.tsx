"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ClientCard } from "@/components/clients/client-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonCard } from "@/components/shared/skeleton-loader";
import { getClients } from "@/lib/actions/clients";
import type { Client } from "@/types/database";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await getClients();
      if (result.success && result.data) {
        setClients(result.data);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Manage your agency clients"
        actions={
          <Link href="/clients/new">
            <Button>
              <Plus className="size-4" />
              Add Client
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="Create your first client to start managing their projects."
          icon={<Building2 className="size-8 text-muted-foreground" />}
          action={{
            label: "Add Client",
            href: "/clients/new",
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
        </div>
      )}
    </div>
  );
}
