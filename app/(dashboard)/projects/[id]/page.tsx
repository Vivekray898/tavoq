"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Trash2,
  Users,
  FolderKanban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { ProjectResources } from "@/components/projects/project-resources";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { ErrorMessage } from "@/components/shared/error-message";
import { getProject, deleteProjectAction } from "@/lib/actions/projects";
import { formatDate, getInitials } from "@/lib/utils";
import { toast } from "sonner";
import type { ProjectWithRelations } from "@/types/database";

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const result = await getProject(projectId);
      if (result.success && result.data) {
        setProject(result.data);
      } else {
        setError(result.error || "Project not found");
      }
      setLoading(false);
    }
    load();
  }, [projectId]);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this project? All tasks and data will be deleted.")) {
      return;
    }

    setIsDeleting(true);
    const result = await deleteProjectAction(projectId);

    if (result.success) {
      toast.success("Project deleted");
      router.push("/projects");
    } else {
      toast.error(result.error || "Failed to delete project");
    }
    setIsDeleting(false);
  }

  if (loading) return <SkeletonPage />;
  if (error || !project) {
    return <ErrorMessage message={error || "Project not found"} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <PageHeader
          title={project.name}
          description={project.client?.name}
          actions={
            <div className="flex items-center gap-2">
              <ProjectStatusBadge status={project.status} />
              <Link href={`/projects/${project.id}/edit`}>
                <Button variant="outline" size="sm">
                  <Pencil className="size-4" />
                  Edit
                </Button>
              </Link>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </div>
          }
        />
      </div>

      {/* Project Info */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Client</p>
              <p className="font-medium">{project.client?.name || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <ProjectStatusBadge status={project.status} />
            </div>
            {project.start_date && (
              <div>
                <p className="text-muted-foreground">Start Date</p>
                <p className="font-medium">{formatDate(project.start_date)}</p>
              </div>
            )}
            {project.end_date && (
              <div>
                <p className="text-muted-foreground">End Date</p>
                <p className="font-medium">{formatDate(project.end_date)}</p>
              </div>
            )}
          </div>
          {project.description && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                {project.description}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4" />
            Members
            {project.members && ` (${project.members.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {project.members && project.members.length > 0 ? (
            <div className="space-y-2">
              {project.members.map((member) => (
                <div key={member.id} className="flex items-center gap-3">
                  <Avatar className="size-8">
                    <AvatarFallback className="text-xs">
                      {member.user ? getInitials(member.user.full_name) : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">
                      {member.user?.full_name || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.role}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No members assigned yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Resources */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FolderKanban className="size-4" />
            Resources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectResources
            projectId={projectId}
            resources={project.resources || []}
            onResourcesChange={(resources) =>
              setProject((prev) =>
                prev ? { ...prev, resources } : prev
              )
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
