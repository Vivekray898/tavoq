import Link from "next/link";
import { Calendar, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/utils";
import type { ProjectWithRelations } from "@/types/database";

interface ProjectCardProps {
  project: ProjectWithRelations;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:shadow-sm transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate">{project.name}</h3>
              {project.client && (
                <p className="text-sm text-muted-foreground truncate">
                  {project.client.name}
                </p>
              )}
            </div>
            <ProjectStatusBadge status={project.status} />
          </div>

          {project.description && (
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
              {project.description}
            </p>
          )}

          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            {(project.start_date || project.end_date) && (
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5" />
                {project.start_date && formatDate(project.start_date)}
                {project.start_date && project.end_date && " — "}
                {project.end_date && formatDate(project.end_date)}
              </span>
            )}
            {project.members && project.members.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="size-3.5" />
                {project.members.length} member{project.members.length !== 1 && "s"}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
