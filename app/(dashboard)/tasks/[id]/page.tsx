"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  IndianRupee,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Sheet,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TaskComments } from "@/components/tasks/task-comments";
import { TaskSubtasks } from "@/components/tasks/task-subtasks";
import { LabelsEditor } from "@/components/tasks/labels-editor";
import { ActivityTimeline } from "@/components/tasks/activity-timeline";
import { SubmitTaskDialog } from "@/components/tasks/submit-task-dialog";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { StatusDot } from "@/components/shared/status-dot";
import { createClient } from "@/lib/supabase/client";
import {
  getTask,
  updateTaskStatus,
  uploadTaskAttachment,
  deleteTaskAttachment,
  getAttachmentUrl,
  deleteTaskAction,
} from "@/lib/actions/tasks";
import { getLabels } from "@/lib/actions/task-extras";
import {
  formatDeadline,
  formatCurrency,
  formatFileSize,
  getInitials,
  isOverdue,
  cn,
} from "@/lib/utils";
import type { TaskDetail } from "@/lib/actions/tasks";
import type { Label, ResourceType } from "@/types/database";

const RESOURCE_ICONS: Record<ResourceType, typeof Globe> = {
  DRIVE: FileText,
  CANVA: FileText,
  GOOGLE_DOC: FileText,
  GOOGLE_SHEET: Sheet,
  WEBSITE: Globe,
  OTHER: ChevronRight,
};

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.id as string;
  const router = useRouter();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [userRole, setUserRole] = useState<"ADMIN" | "EMPLOYEE">("EMPLOYEE");
  const [updating, setUpdating] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [deletingAttId, setDeletingAttId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (profile) setUserRole(profile.role);
    }

    const result = await getTask(taskId);
    if (result.success && result.data) {
      setTask(result.data);
      setNotFound(null);
    } else {
      setNotFound(result.error ?? "Task not found");
    }
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    void load();
    void getLabels().then((r) => {
      if (r.success && r.data) setLabels(r.data);
    });
  }, [load]);

  // Realtime: task row changes (status, etc.) → refetch
  useEffect(() => {
    if (!taskId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`task-detail:${taskId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks", filter: `id=eq.${taskId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(load, 400);
        }
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [taskId, load]);

  async function handleStatus(status: Parameters<typeof updateTaskStatus>[1], note?: string) {
    setUpdating(true);
    const result = await updateTaskStatus(taskId, status, note);
    setUpdating(false);
    if (result.success && result.data) {
      setTask((prev) => (prev ? { ...prev, status: result.data!.status } : prev));
      toast.success(
        status === "SUBMITTED"
          ? "Submitted for review"
          : status === "COMPLETED"
            ? "Task approved"
            : status === "REVISION_REQUIRED"
              ? "Revision requested"
              : status === "IN_PROGRESS"
                ? "Started working"
                : "Task updated"
      );
      setRevisionOpen(false);
      setRevisionNote("");
      setSubmitOpen(false);
    } else {
      toast.error(result.error ?? "Couldn't update the task");
    }
  }

  async function uploadThenAttach(file: File): Promise<boolean> {
    const result = await uploadTaskAttachment(taskId, file);
    if (result.success && result.data) {
      setTask((prev) =>
        prev
          ? {
              ...prev,
              attachments: [
                ...prev.attachments,
                {
                  id: result.data!.id,
                  file_name: result.data!.file_name,
                  file_path: result.data!.file_path,
                  file_size: file.size,
                  mime_type: file.type || null,
                  uploaded_by: currentUserId,
                  created_at: new Date().toISOString(),
                },
              ],
            }
          : prev
      );
      return true;
    }
    toast.error(result.error ?? `Couldn't upload ${file.name}`);
    return false;
  }

  async function openAttachment(att: TaskDetail["attachments"][number]) {
    const res = await getAttachmentUrl(att.file_path);
    if (res.success && res.data) {
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    } else {
      toast.error(res.error ?? "Couldn't open the file");
    }
  }

  async function handleDeleteAttachment(attId: string) {
    setDeletingAttId(attId);
    const result = await deleteTaskAttachment(attId);
    setDeletingAttId(null);
    if (result.success) {
      setTask((prev) =>
        prev
          ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== attId) }
          : prev
      );
      toast.success("File removed");
    } else {
      toast.error(result.error ?? "Couldn't remove the file");
    }
  }

  async function handleDeleteTask() {
    setDeletingTask(true);
    const result = await deleteTaskAction(taskId);
    setDeletingTask(false);
    if (!result.success) {
      toast.error(result.error ?? "Couldn't delete the task");
      return;
    }
    toast.success("Task deleted");
    router.replace("/tasks");
    router.refresh();
  }

  if (loading) return <SkeletonPage />;

  if (notFound || !task) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-lg font-semibold">Task not available</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {notFound === "Access denied" || notFound?.includes("access")
            ? "You don't have access to this task."
            : "This task may have been deleted."}
        </p>
        <Link href="/tasks" className="mt-6">
          <Button variant="outline">Back to tasks</Button>
        </Link>
      </div>
    );
  }

  const isAssignee = task.assigned_to === currentUserId;
  const isAdmin = userRole === "ADMIN";

  // Primary action logic (§12)
  let primaryAction: { label: string; status: Parameters<typeof updateTaskStatus>[1]; dialog?: boolean } | null =
    null;
  let secondaryAction: { label: string; status: Parameters<typeof updateTaskStatus>[1] } | null =
    null;

  if (isAssignee && !isAdmin) {
    if (task.status === "TODO") {
      primaryAction = { label: "Start working", status: "IN_PROGRESS" };
      secondaryAction = { label: "Submit for review", status: "SUBMITTED" };
    } else if (task.status === "IN_PROGRESS") {
      primaryAction = { label: "Submit for review", status: "SUBMITTED", dialog: true };
    } else if (task.status === "REVISION_REQUIRED") {
      primaryAction = { label: "Resubmit for review", status: "SUBMITTED", dialog: true };
    }
  }

  const overdue = task.deadline ? isOverdue(task.deadline) : false;

  return (
    <div className="pb-24 lg:pb-10">
      {/* Mobile back header (§33) */}
      <div className="mb-3 flex items-center gap-2 lg:hidden">
        <Link
          href="/tasks"
          className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-accent"
          aria-label="Back to tasks"
        >
          <ArrowLeft className="size-4.5" />
        </Link>
      </div>

      {/* Title block */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
            {task.title}
          </h1>
          {isAdmin && (
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/tasks/${task.id}/edit`}
                className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:block"
              >
                Edit
              </Link>
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {task.client_name ? `${task.client_name} · ` : ""}
          <Link href={`/projects/${task.project_id}`} className="hover:text-foreground hover:underline">
            {task.project_name}
          </Link>
        </p>
        {/* Labels (§19) */}
        <div className="mt-2.5">
          <LabelsEditor
            taskId={task.id}
            current={task.labels}
            allLabels={labels}
            canEdit={isAdmin || isAssignee}
            onChange={(next) => setTask((prev) => (prev ? { ...prev, labels: next } : prev))}
          />
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {task.title}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Comments, files, labels, subtasks, and related task activity will be removed. Tasks with payment records must be archived instead.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={deletingTask} onClick={handleDeleteTask}>
              {deletingTask ? "Deleting..." : "Delete task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        {/* Main column */}
        <div className="min-w-0 space-y-8">
          {/* Task instructions */}
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Task
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {task.description || "No instructions provided."}
            </p>
          </section>

          {/* Checklist (§21) */}
          {(task.subtasks.length > 0 || isAssignee || isAdmin) && (
            <TaskSubtasks
              taskId={task.id}
              initialSubtasks={task.subtasks}
              canEdit={isAdmin || isAssignee}
              onChange={(next) =>
                setTask((prev) => (prev ? { ...prev, subtasks: next } : prev))
              }
            />
          )}

          {/* Resources (§22) */}
          {task.resources.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Resources
              </h2>
              <div className="divide-y rounded-xl border bg-card">
                {task.resources.map((r) => {
                  const Icon = RESOURCE_ICONS[(r.resource_type as ResourceType) ?? "OTHER"] ?? Globe;
                  return (
                    <a
                      key={r.id}
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        {r.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {r.description}
                          </p>
                        )}
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        Open <ExternalLink className="size-3" />
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* Attachments */}
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Files
            </h2>
            {task.attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No files yet. Attach work using the paperclip in the conversation below.
              </p>
            ) : (
              <div className="divide-y rounded-xl border bg-card">
                {task.attachments.map((att) => (
                  <div key={att.id} className="flex items-center gap-3 px-4 py-3">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => openAttachment(att)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium hover:underline">
                        {att.file_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          formatFileSize(att.file_size),
                          getInitials(att.uploaded_by) && "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </button>
                    {(isAdmin || att.uploaded_by === currentUserId) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteAttachment(att.id)}
                        disabled={deletingAttId === att.id}
                        aria-label={`Delete ${att.file_name}`}
                      >
                        {deletingAttId === att.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Comments (§13/§15) */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversation
            </h2>
            <TaskComments
              taskId={taskId}
              initialComments={task.comments}
              currentUserId={currentUserId}
              onAttachmentAdded={(att) =>
                setTask((prev) =>
                  prev ? { ...prev, attachments: [...prev.attachments, att] } : prev
                )
              }
            />
          </section>

          {/* Activity (§30) */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Activity
            </h2>
            <ActivityTimeline taskId={taskId} />
          </section>
        </div>

        {/* Details sidebar */}
        <aside className="space-y-4">
          <div className="rounded-xl border bg-card px-4 py-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Status</span>
              <StatusDot status={task.status} className="text-foreground" />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <User className="size-3.5" /> Assigned to
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <Avatar className="size-5">
                  <AvatarFallback className="text-[8px]">
                    {getInitials(task.assigned_name)}
                  </AvatarFallback>
                </Avatar>
                {task.assigned_name ?? "Unassigned"}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="size-3.5" /> Due
              </span>
              <span className={cn("font-medium", overdue && "text-destructive")}>
                {formatDeadline(task.deadline)}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <IndianRupee className="size-3.5" /> Payout
              </span>
              <span className="font-medium">
                {task.payout_amount > 0 ? formatCurrency(task.payout_amount) : "—"}
              </span>
            </div>
            {task.payout_amount > 0 && (
              <>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    Payment
                  </span>
                  <span
                    className={cn(
                      "font-medium",
                      task.payment_status === "PAID" && "text-emerald-600 dark:text-emerald-400",
                      task.payment_status === "PENDING" && "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {task.payment_status === "PAID"
                      ? "Paid"
                      : task.payment_status === "PENDING"
                        ? "Pending"
                        : "—"}
                  </span>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Revision dialog (admin) */}
      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request revision</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Explain what needs to change…"
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleStatus("REVISION_REQUIRED", revisionNote.trim() || undefined)}
              disabled={updating}
            >
              {updating ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              Send revision request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit dialog (§14) */}
      <SubmitTaskDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title={task.status === "REVISION_REQUIRED" ? "Resubmit task" : "Submit task"}
        onSubmit={async (note) => handleStatus("SUBMITTED", note)}
        onFileSelected={uploadThenAttach}
      />

      {/* Sticky action bar (§12) */}
      {(primaryAction || (isAdmin && task.status === "SUBMITTED")) && (
        <div
          className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 p-3 backdrop-blur lg:static lg:bottom-auto lg:mt-8 lg:rounded-xl lg:border lg:bg-card lg:p-4 lg:backdrop-blur-none"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-0 lg:px-4">
            <div className="flex-1 lg:hidden">
              <StatusDot status={task.status} />
            </div>
            <div className="flex flex-1 justify-end gap-2 lg:flex-none">
              {isAdmin && task.status === "SUBMITTED" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setRevisionOpen(true)}
                    disabled={updating}
                    className="flex-1 sm:flex-none"
                  >
                    <RotateCcw className="size-4" />
                    Request revision
                  </Button>
                  <Button
                    onClick={() => handleStatus("COMPLETED")}
                    disabled={updating}
                    className="flex-1 sm:flex-none"
                  >
                    {updating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    Approve
                  </Button>
                </>
              )}
              {primaryAction && (
                <>
                  {secondaryAction && task.status === "TODO" && (
                    <Button
                      variant="outline"
                      onClick={() => setSubmitOpen(true)}
                      disabled={updating}
                      className="flex-1 sm:flex-none"
                    >
                      <Send className="size-4" />
                      {secondaryAction.label}
                    </Button>
                  )}
                  <Button
                    onClick={() =>
                      primaryAction!.dialog ? setSubmitOpen(true) : handleStatus(primaryAction!.status)
                    }
                    disabled={updating}
                    className="flex-1 sm:flex-none"
                  >
                    {updating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : task.status === "TODO" ? (
                      <Play className="size-4" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {primaryAction.label}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Separator() {
  return <div className="my-3 h-px bg-border" />;
}
