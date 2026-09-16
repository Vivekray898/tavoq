"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Archive,
  ExternalLink,
  Globe,
  Mail,
  Pencil,
  Phone,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { getClient, archiveClientAction } from "@/lib/actions/clients";
import { cn } from "@/lib/utils";
import type { ClientDetail } from "@/lib/actions/clients";

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await getClient(clientId);
      if (result.success && result.data) {
        setClient(result.data);
      } else {
        setError(result.error ?? "Client not found");
      }
      setLoading(false);
    })();
  }, [clientId]);

  async function handleArchive() {
    setArchiving(true);
    const result = await archiveClientAction(clientId);
    setArchiving(false);
    if (result.success) {
      toast.success("Client archived");
      router.push("/clients");
    } else {
      toast.error(result.error ?? "Couldn't archive client");
    }
  }

  if (loading) return <SkeletonPage />;

  if (error || !client) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-lg font-semibold">Client not found</h2>
        <Link href="/clients" className="mt-6">
          <Button variant="outline">Back to clients</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {/* Mobile back */}
      <div className="mb-3 lg:hidden">
        <Link
          href="/clients"
          className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-accent"
          aria-label="Back to clients"
        >
          <ArrowLeft className="size-4.5" />
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {client.name}
          </h1>
          {client.company_name && (
            <p className="mt-1 text-sm text-muted-foreground">{client.company_name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/clients/${client.id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil className="size-4" /> Edit
            </Button>
          </Link>
          {client.active && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setArchiveOpen(true)}
            >
              <Archive className="size-4" />
              <span className="hidden sm:inline">Archive</span>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
        {/* Contact */}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contact
          </h2>
          <div className="space-y-2.5 text-sm">
            {client.email && (
              <a
                href={`mailto:${client.email}`}
                className="flex items-center gap-2.5 text-foreground hover:underline"
              >
                <Mail className="size-4 text-muted-foreground" />
                {client.email}
              </a>
            )}
            {client.phone && (
              <a
                href={`tel:${client.phone}`}
                className="flex items-center gap-2.5 text-foreground hover:underline"
              >
                <Phone className="size-4 text-muted-foreground" />
                {client.phone}
              </a>
            )}
            {client.website && (
              <a
                href={client.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 text-foreground hover:underline"
              >
                <Globe className="size-4 text-muted-foreground" />
                <span className="truncate">
                  {client.website.replace(/^https?:\/\//, "")}
                </span>
                <ExternalLink className="size-3 text-muted-foreground" />
              </a>
            )}
            {!client.email && !client.phone && !client.website && (
              <p className="text-muted-foreground">No contact details yet.</p>
            )}
          </div>
          {client.notes && (
            <div className="mt-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notes
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {client.notes}
              </p>
            </div>
          )}
        </section>

        {/* Projects */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Projects</h2>
            <Link href={`/projects/new${client.active ? `?client=${client.id}` : ""}`}>
              <Button size="sm" variant="outline">
                <Plus className="size-4" /> New project
              </Button>
            </Link>
          </div>
          {client.projects.length === 0 ? (
            <EmptyState
              title="No projects for this client yet"
              description="Create a project to start assigning work."
              compact
              action={{ label: "New project", href: `/projects/new?client=${client.id}` }}
            />
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {client.projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {p.active_tasks} active task{p.active_tasks !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      p.status === "ACTIVE"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {p.status === "ACTIVE" ? "Active" : p.status.replaceAll("_", " ").toLowerCase()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Archive confirmation (§55) */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {client.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The client and their history will be kept, but they&apos;ll be hidden from
            new project creation. You can restore them anytime by editing the client.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleArchive} disabled={archiving}>
              {archiving ? "Archiving…" : "Archive client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
