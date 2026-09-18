"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Archive,
  ExternalLink,
  FileText,
  Globe,
  Plus,
  Sheet,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { TaskCard } from "@/components/tasks/task-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ActivityTimeline } from "@/components/tasks/activity-timeline";
import {
  addProjectResource,
  deleteProjectResource,
  archiveProjectAction,
} from "@/lib/actions/projects";
import {
  projectDetailOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { useSession } from "@/components/providers/session-provider";
import {
  formatDate,
  getInitials,
  cn,
} from "@/lib/utils";
import type { ProjectDetail } from "@/lib/actions/projects";
import type { ResourceType } from "@/types/database";

const RESOURCE_ICONS: Record<ResourceType, typeof Globe> = {
  DRIVE: FileText,
  CANVA: FileText,
  GOOGLE_DOC: FileText,
  GOOGLE_SHEET: Sheet,
  WEBSITE: Globe,
  OTHER: Globe,
};

type Tab = "overview" | "tasks" | "resources" | "activity";

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = params.id as string;
  const { role } = useSession();
  const isAdmin = role === "ADMIN";

  // Cached detail — revisiting a project reads cache instantly (§3).
  const projectQuery = useQuery(projectDetailOptions(projectId));
  const project = projectQuery.data ?? null;
  const loading = projectQuery.isLoading;
  const error = projectQuery.isError
    ? projectQuery.error instanceof Error
      ? projectQuery.error.message
      : "Project not found"
    : null;

  const [tab, setTab] = useState<Tab>("overview");

  // Add resource dialog
  const [resOpen, setResOpen] = useState(false);
  const [resTitle, setResTitle] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [resType, setResType] = useState<ResourceType>("DRIVE");
  const [resDesc, setResDesc] = useState("");
  const [addingRes, setAddingRes] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  if (loading) return <SkeletonPage />;

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-lg font-semibold">Project not available</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error?.includes("access")
            ? "You don't have access to this project."
            : "This project may have been archived."}
        </p>
        <Link href="/projects" className="mt-6">
          <Button variant="outline">Back to projects</Button>
        </Link>
      </div>
    );
  }

  async function handleAddResource() {
    if (!resTitle.trim() || !resUrl.trim()) return;
    setAddingRes(true);
    const result = await addProjectResource(projectId, {
      title: resTitle.trim(),
      url: resUrl.trim(),
      description: resDesc.trim() || undefined,
      resource_type: resType,
    });
    setAddingRes(false);
    if (result.success && result.data) {
      queryClient.setQueryData<ProjectDetail>(qk.projectDetail(projectId), (prev) =>
        prev ? { ...prev, resources: [...prev.resources, result.data!] } : prev
      );
      setResOpen(false);
      setResTitle("");
      setResUrl("");
      setResDesc("");
      setResType("DRIVE");
      toast.success("Resource added");
    } else {
      toast.error(result.error ?? "Couldn't add resource");
    }
  }

  async function handleDeleteResource(id: string) {
    const result = await deleteProjectResource(id);
    if (result.success) {
      queryClient.setQueryData<ProjectDetail>(qk.projectDetail(projectId), (prev) =>
        prev ? { ...prev, resources: prev.resources.filter((r) => r.id !== id) } : prev
      );
      toast.success("Resource removed");
    } else {
      toast.error(result.error ?? "Couldn't remove resource");
    }
  }

  async function handleArchive() {
    setArchiving(true);
    const result = await archiveProjectAction(projectId);
    setArchiving(false);
    if (!result.success) {
      toast.error(result.error ?? "Couldn't archive project");
      return;
    }
    toast.success("Project archived");
    // Targeted cache cleanup — the projects list refetches when next shown.
    queryClient.removeQueries({ queryKey: qk.projectDetail(projectId) });
    router.push("/projects");
  }

  const counts = project.task_counts;

  return (
    <div className="pb-10">
      {/* Mobile back header */}
      <div className="mb-3 lg:hidden">
        <Link
          href="/projects"
          className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-accent"
          aria-label="Back to projects"
        >
          <ArrowLeft className="size-4.5" />
        </Link>
      </div>

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {project.name}
        </h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{project.client_name}</span>
          <span>·</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              project.status === "ACTIVE"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-muted text-muted-foreground"
            )}
          >
            {project.status === "ACTIVE" ? "Active" : project.status.replaceAll("_", " ").toLowerCase()}
          </span>
          {isAdmin && (
            <div className="ml-2 flex items-center gap-2">
              <Link
                href={`/projects/${project.id}/edit`}
                className="text-xs font-medium hover:text-foreground hover:underline"
              >
                Edit
              </Link>
              {project.status !== "ARCHIVED" && (
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setArchiveOpen(true)}>
                  <Archive className="size-4" />
                  <span className="hidden sm:inline">Archive</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {project.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The project, its tasks, comments, resources, and activity will be kept. It will be hidden from active project views.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={archiving} onClick={handleArchive}>
              {archiving ? "Archiving..." : "Archive project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tabs (§21) */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b">
        {(["overview", "tasks", "resources", "activity"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "relative h-9 shrink-0 px-3.5 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-6">
          {project.description && (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {project.description}
            </p>
          )}

          <div className="grid max-w-md grid-cols-4 gap-3">
            {[
              { label: "Tasks", value: counts.total },
              { label: "Completed", value: counts.completed },
              { label: "In progress", value: counts.in_progress },
              { label: "In review", value: counts.submitted },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border bg-card px-3 py-3 text-center"
              >
                <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* §16 — lightweight progress from existing task data */}
          {counts.total > 0 && (
            <div className="max-w-md">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {counts.completed} / {counts.total} tasks completed
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {Math.round((counts.completed / counts.total) * 100)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round((counts.completed / counts.total) * 100)}%` }}
                />
              </div>
              {counts.overdue > 0 && (
                <p className="mt-1.5 text-xs text-destructive">
                  {counts.overdue} overdue
                </p>
              )}
            </div>
          )}

          {/* Members */}
          <section>
            <h2 className="mb-3 text-sm font-semibold">Team</h2>
            {project.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members assigned yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {project.members.map((m) => {
                  const user = (m as unknown as { user?: { full_name: string; avatar_url: string | null } }).user;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3"
                    >
                      <Avatar className="size-7">
                        <AvatarFallback className="text-[10px]">
                          {getInitials(user?.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[13px] font-medium">
                        {user?.full_name ?? "Member"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {(project.start_date || project.end_date) && (
            <p className="text-sm text-muted-foreground">
              {project.start_date && `Started ${formatDate(project.start_date)}`}
              {project.start_date && project.end_date && " → "}
              {project.end_date && `Ends ${formatDate(project.end_date)}`}
            </p>
          )}
        </div>
      )}

      {/* Tasks */}
      {tab === "tasks" && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {counts.total} task{counts.total !== 1 ? "s" : ""}
            </p>
            {isAdmin && (
              <Link href={`/tasks/new?project=${project.id}`}>
                <Button size="sm" variant="outline">
                  <Plus className="size-4" /> New task
                </Button>
              </Link>
            )}
          </div>
          {project.tasks.length === 0 ? (
            <EmptyState
              title="No tasks in this project yet"
              description={
                isAdmin
                  ? "Create the first task to start assigning work."
                  : "Tasks will appear here once they're assigned."
              }
              action={
                isAdmin
                  ? { label: "New task", href: `/tasks/new?project=${project.id}` }
                  : undefined
              }
            />
          ) : (
            <div className="space-y-2.5">
              {project.tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  title={t.title}
                  subtitle={t.assigned_name}
                  status={t.status as never}
                  priority={t.priority}
                  deadline={t.deadline}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resources */}
      {tab === "resources" && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {project.resources.length} link{project.resources.length !== 1 ? "s" : ""}
            </p>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setResOpen(true)}>
                <Plus className="size-4" /> Add resource
              </Button>
            )}
          </div>
          {project.resources.length === 0 ? (
            <EmptyState
              title="No resources yet"
              description="Add Google Drive folders, Canva templates and other links your team needs."
              action={isAdmin ? { label: "Add resource", onClick: () => setResOpen(true) } : undefined}
            />
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {project.resources.map((r) => {
                const Icon = RESOURCE_ICONS[(r.resource_type as ResourceType) ?? "OTHER"] ?? Globe;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate text-sm font-medium hover:underline">
                        {r.title}
                      </p>
                      {r.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {r.description}
                        </p>
                      )}
                    </a>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      Open <ExternalLink className="size-3" />
                    </span>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteResource(r.id)}
                        aria-label={`Remove ${r.title}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Activity */}
      {tab === "activity" && <ActivityTimeline projectId={projectId} />}

      {/* Add resource dialog */}
      <Dialog open={resOpen} onOpenChange={setResOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add resource</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={resTitle}
                onChange={(e) => setResTitle(e.target.value)}
                placeholder="e.g. Client Assets"
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-sm font-medium">URL</label>
              <Input
                value={resUrl}
                onChange={(e) => setResUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={resType} onValueChange={(v) => setResType(v as ResourceType)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRIVE">Google Drive</SelectItem>
                  <SelectItem value="CANVA">Canva</SelectItem>
                  <SelectItem value="GOOGLE_DOC">Google Doc</SelectItem>
                  <SelectItem value="GOOGLE_SHEET">Google Sheet</SelectItem>
                  <SelectItem value="WEBSITE">Website</SelectItem>
                  <SelectItem value="OTHER">Link</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={resDesc}
                onChange={(e) => setResDesc(e.target.value)}
                placeholder="Optional note…"
                rows={2}
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddResource} disabled={addingRes || !resTitle.trim() || !resUrl.trim()}>
              {addingRes ? "Adding…" : "Add resource"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
