"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Building2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import {
  archiveClientAction,
  restoreClientAction,
  deleteClientAction,
} from "@/lib/actions/clients";
import { clientsListOptions } from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";

interface ClientRow {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  active: boolean;
  projects_count: number;
}

type ClientsTab = "active" | "archived";

export function ClientsList() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ClientsTab>("active");
  const [confirmDelete, setConfirmDelete] = useState<ClientRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Cached per tab; revisiting or switching tabs serves cache (§3).
  const activeQuery = useQuery(clientsListOptions(false));
  const archivedQuery = useQuery(clientsListOptions(true));
  const clients = (tab === "active" ? activeQuery.data : archivedQuery.data) ?? [];
  const loading = tab === "active" ? activeQuery.isLoading : archivedQuery.isLoading;

  async function handleArchive(id: string) {
    const result = await archiveClientAction(id);
    if (result.success) {
      toast.success("Client archived");
      await queryClient.invalidateQueries({ queryKey: ["clients", "list"], refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't archive the client");
    }
  }

  async function handleRestore(id: string) {
    const result = await restoreClientAction(id);
    if (result.success) {
      toast.success("Client restored");
      await queryClient.invalidateQueries({ queryKey: ["clients", "list"], refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't restore the client");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    const result = await deleteClientAction(confirmDelete.id);
    setDeleting(false);
    if (result.success) {
      toast.success("Client deleted permanently");
      setConfirmDelete(null);
      queryClient.setQueryData<ClientRow[]>(qk.clientsList(true), (prev) =>
        prev ? prev.filter((c) => c.id !== confirmDelete.id) : prev
      );
      queryClient.removeQueries({ queryKey: qk.clientDetail(confirmDelete.id) });
    } else {
      toast.error(result.error ?? "Couldn't delete the client");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Clients</h1>
        {tab === "active" && (
          <Link href="/clients/new">
            <Button size="sm">
              <Plus className="size-4" /> Add client
            </Button>
          </Link>
        )}
      </div>

      {/* §44 — Active | Archived tabs, same pattern as projects */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 sm:w-fit">
        <Button
          type="button"
          variant={tab === "active" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("active")}
        >
          Active
        </Button>
        <Button
          type="button"
          variant={tab === "archived" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("archived")}
        >
          Archived
        </Button>
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : clients.length === 0 ? (
        tab === "active" ? (
          <EmptyState
            title="No clients yet"
            description="Create your first client, then add projects and assign work."
            icon={<Building2 />}
            action={{ label: "Add client", href: "/clients/new" }}
          />
        ) : (
          <EmptyState
            title="No archived clients"
            description="Archived clients move here — out of the working list, but never lost."
            icon={<Archive />}
          />
        )
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {clients.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3.5">
              <Link
                href={`/clients/${c.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:text-foreground"
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
              </Link>
              {tab === "active" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={`Archive ${c.name}`}
                  onClick={() => handleArchive(c.id)}
                >
                  <Archive className="size-3.5" />
                </Button>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestore(c.id)}
                  >
                    <ArchiveRestore className="size-3.5" /> Restore
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${c.name} permanently`}
                    onClick={() => setConfirmDelete(c)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}” permanently?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Only clients without projects can be deleted —
              archiving keeps all history instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
