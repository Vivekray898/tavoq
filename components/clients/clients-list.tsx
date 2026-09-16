"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { getClients } from "@/lib/actions/clients";

interface ClientRow {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  active: boolean;
  projects_count: number;
}

export function ClientsList() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await getClients();
      if (result.success && result.data) {
        setClients(
          result.data.map((c) => ({
            id: c.id,
            name: c.name,
            company_name: c.company_name,
            email: c.email,
            active: c.active,
            projects_count: c.projects_count,
          }))
        );
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Clients</h1>
        <Link href="/clients/new">
          <Button size="sm">
            <Plus className="size-4" /> Add client
          </Button>
        </Link>
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="Create your first client, then add projects and assign work."
          icon={<Building2 />}
          action={{ label: "Add client", href: "/clients/new" }}
        />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
                {c.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {c.company_name ?? c.email ?? "—"}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {c.projects_count} project{c.projects_count !== 1 ? "s" : ""}
              </span>
              {!c.active && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Archived
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

