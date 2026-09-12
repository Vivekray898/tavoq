"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonCard } from "@/components/shared/skeleton-loader";
import { getProjects } from "@/lib/actions/projects";
import type { ProjectWithRelations } from "@/types/database";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await getProjects();
      if (result.success && result.data) {
        setProjects(result.data);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Manage client projects"
        actions={
          <Link href="/projects/new">
            <Button>
              <Plus className="size-4" />
              New Project
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
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to start assigning work."
          icon={<FolderKanban className="size-8 text-muted-foreground" />}
          action={{
            label: "New Project",
            href: "/projects/new",
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
