"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Plus, FolderKanban, Trash2 } from "lucide-react";
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
  getProjects,
  archiveProjectAction,
  restoreProjectAction,
  deleteProjectAction,
} from "@/lib/actions/projects";
import { getMyRole } from "@/lib/actions/session";
import { cn } from "@/lib/utils";

interface ProjectRow {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  active_tasks: number;
}

type ProjectsTab = "active" | "archived";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<ProjectsTab>("active");
  const [confirmDelete, setConfirmDelete] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (archived: boolean) => {
    setLoading(true);
    const projectsRes = await getProjects({ archived });
    if (projectsRes.success && projectsRes.data) {
      setProjects(
        projectsRes.data.map((p) => ({
          id: p.id,
          name: p.name,
          client_name: p.client_name,
          status: p.status,
          active_tasks: p.active_tasks,
        }))
      );
    } else {
      setProjects([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const me = await getMyRole();
      setIsAdmin(me.success && me.data?.role === "ADMIN");
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void load(tab === "archived");
    });
    return () => {
      cancelled = true;
    };
  }, [tab, load]);

  async function handleRestore(id: string) {
    const result = await restoreProjectAction(id);
    if (result.success) {
      toast.success("Project restored to active");
      void load(tab === "archived");
    } else {
      toast.error(result.error ?? "Couldn't restore the project");
    }
  }

  async function handleArchive(id: string) {
    const result = await archiveProjectAction(id);
    if (result.success) {
      toast.success("Project archived");
      void load(tab === "archived");
    } else {
      toast.error(result.error ?? "Couldn't archive the project");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    const result = await deleteProjectAction(confirmDelete.id);
    setDeleting(false);
    if (result.success) {
      toast.success("Project deleted permanently");
      setConfirmDelete(null);
      void load(true);
    } else {
      toast.error(result.error ?? "Couldn't delete the project");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Projects</h1>
        {isAdmin && tab === "active" && (
          <Link href="/projects/new">
            <Button size="sm">
              <Plus className="size-4" /> New project
            </Button>
          </Link>
        )}
      </div>

      {/* §41 — Active | Archived, never mixed */}
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
      ) : projects.length === 0 ? (
        tab === "active" ? (
          <EmptyState
            title="No projects yet"
            description="Create your first client project and start assigning work."
            icon={<FolderKanban />}
            action={isAdmin ? { label: "New project", href: "/projects/new" } : undefined}
          />
        ) : (
          <EmptyState
            title="No archived projects"
            description="Projects you archive will appear here and can be restored anytime."
            icon={<Archive />}
          />
        )
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3.5">
              <Link
                href={`/projects/${p.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:text-foreground"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {p.client_name ?? "—"}
                  </p>
                </div>
                {tab === "active" ? (
                  <>
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
                    <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:block">
                      {p.active_tasks} active
                    </span>
                  </>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Archived
                  </span>
                )}
              </Link>
              {isAdmin && tab === "active" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={`Archive ${p.name}`}
                  onClick={() => handleArchive(p.id)}
                >
                  <Archive className="size-3.5" />
                </Button>
              )}
              {isAdmin && tab === "archived" && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestore(p.id)}
                  >
                    <ArchiveRestore className="size-3.5" /> Restore
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${p.name} permanently`}
                    onClick={() => setConfirmDelete(p)}
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
              This cannot be undone. Only projects without tasks can be deleted —
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
