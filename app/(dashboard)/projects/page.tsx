"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { getProjects } from "@/lib/actions/projects";
import { getMyRole } from "@/lib/actions/session";
import { cn } from "@/lib/utils";

interface ProjectRow {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  active_tasks: number;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await getMyRole();
      setIsAdmin(me.success && me.data?.role === "ADMIN");
      const projectsRes = await getProjects();
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
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Projects</h1>
        {isAdmin && (
          <Link href="/projects/new">
            <Button size="sm">
              <Plus className="size-4" /> New project
            </Button>
          </Link>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first client project and start assigning work."
          icon={<FolderKanban />}
          action={isAdmin ? { label: "New project", href: "/projects/new" } : undefined}
        />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {p.client_name ?? "—"}
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
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                {p.active_tasks} active
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
