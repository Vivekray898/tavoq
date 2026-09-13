"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Trash2,
  Clock,
  IndianRupee,
  MessageSquare,
  Paperclip,
  Send,
  CheckCircle,
  RotateCcw,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { TaskStatusBadge, PaymentStatusBadge } from "@/components/shared/status-badge";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { TaskComments } from "@/components/tasks/task-comments";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { ErrorMessage } from "@/components/shared/error-message";
import { getTask, deleteTaskAction, updateTaskStatus } from "@/lib/actions/tasks";
import { formatDate, isOverdue, isDueToday, cn } from "@/lib/utils";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { TaskWithRelations } from "@/types/database";

export default function TaskDetailPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;
  const [task, setTask] = useState<TaskWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [revisionComment, setRevisionComment] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [userRole, setUserRole] = useState<"ADMIN" | "EMPLOYEE">("EMPLOYEE");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
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
        setTask(result.data as TaskWithRelations & { comments: Array<{ id: string; comment: string; created_at: string; user: { id: string; full_name: string; avatar_url: string | null } }>; attachments: Array<{ id: string; file_name: string; file_path: string; mime_type: string | null; created_at: string }> });
      } else {
        setError(result.error || "Task not found");
      }
      setLoading(false);
    }
    load();
  }, [taskId]);

  async function handleStatusChange(status: string, comment?: string) {
    setIsUpdating(true);
    const result = await updateTaskStatus(
      taskId,
      status as TaskWithRelations["status"],
      comment
    );

    if (result.success && result.data) {
      setTask((prev) => (prev ? { ...prev, status: result.data!.status } : prev));
      toast.success("Task status updated");
      setRevisionComment("");
    } else {
      toast.error(result.error || "Failed to update status");
    }
    setIsUpdating(false);
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this task?")) return;

    setIsDeleting(true);
    const result = await deleteTaskAction(taskId);
    if (result.success) {
      toast.success("Task deleted");
      router.push("/tasks");
    } else {
      toast.error(result.error || "Failed to delete task");
    }
    setIsDeleting(false);
  }

  if (loading) return <SkeletonPage />;
  if (error || !task) {
    return <ErrorMessage message={error || "Task not found"} />;
  }

  const taskWithExtras = task as TaskWithRelations & {
    comments: Array<{ id: string; comment: string; created_at: string; user: { id: string; full_name: string; avatar_url: string | null } }>;
    attachments: Array<{ id: string; file_name: string; file_path: string; mime_type: string | null; created_at: string }>;
  };
  const overdue = isOverdue(task.deadline);
  const dueToday = isDueToday(task.deadline);
  const project = task.project as unknown as { name?: string; client?: { name?: string } } | undefined;
  const assignedUser = (task as unknown as { assigned_user?: { full_name?: string } }).assigned_user;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <PageHeader
          title={task.title}
          description={project?.client?.name}
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <TaskStatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              {userRole === "ADMIN" && (
                <>
                  <Link href={`/tasks/${taskId}/edit`}>
                    <Button variant="outline" size="sm">
                      <Pencil className="size-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          }
        />
      </div>

      {/* Task Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          {task.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{task.description}</p>
              </CardContent>
            </Card>
          )}

          {/* Resources (from project) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resources</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                View project resources in the{" "}
                <Link href={`/projects/${task.project_id}`} className="underline">
                  project page
                </Link>
                .
              </p>
            </CardContent>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="size-4" />
                Comments
                {taskWithExtras.comments && taskWithExtras.comments.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({taskWithExtras.comments.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TaskComments
                taskId={taskId}
                comments={taskWithExtras.comments || []}
                currentUserId={currentUserId}
                onCommentAdded={(comment) =>
                  setTask((prev) =>
                    prev
                      ? {
                          ...prev,
                          comments: [...((prev as unknown as { comments: unknown[] }).comments || []), comment],
                        }
                      : prev
                  )
                }
              />
            </CardContent>
          </Card>

          {/* Attachments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Paperclip className="size-4" />
                Attachments
                {taskWithExtras.attachments && taskWithExtras.attachments.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({taskWithExtras.attachments.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {taskWithExtras.attachments && taskWithExtras.attachments.length > 0 ? (
                <div className="space-y-2">
                  {taskWithExtras.attachments.map((att) => (
                    <div key={att.id} className="flex items-center gap-2 p-2 rounded border">
                      <Paperclip className="size-4 text-muted-foreground" />
                      <span className="text-sm flex-1 truncate">{att.file_name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No attachments yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-4">
          {/* Key Details */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Project</p>
                <Link
                  href={`/projects/${task.project_id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {project?.name || "—"}
                </Link>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Assigned To</p>
                <p className="text-sm font-medium">
                  {assignedUser?.full_name || "Unassigned"}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Deadline</p>
                <p
                  className={cn(
                    "text-sm font-medium flex items-center gap-1",
                    overdue && "text-red-600",
                    dueToday && !overdue && "text-orange-600"
                  )}
                >
                  <Clock className="size-3.5" />
                  {task.deadline ? formatDate(task.deadline) : "No deadline"}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Payout</p>
                <p className="text-sm font-medium flex items-center gap-1">
                  <IndianRupee className="size-3.5" />
                  {task.payout_amount > 0 ? task.payout_amount.toLocaleString("en-IN") : "—"}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Payment Status</p>
                <PaymentStatusBadge status={task.payment_status} />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Employee: Submit for Review */}
              {userRole === "EMPLOYEE" &&
                task.assigned_to === currentUserId &&
                (task.status === "TODO" || task.status === "IN_PROGRESS" || task.status === "REVISION_REQUIRED") && (
                  <Button
                    className="w-full"
                    onClick={() => handleStatusChange("SUBMITTED")}
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <Loader2 className="size-4 animate-spin mr-2" />
                    ) : (
                      <Send className="size-4 mr-2" />
                    )}
                    Submit for Review
                  </Button>
                )}

              {/* Admin: Approve */}
              {userRole === "ADMIN" && task.status === "SUBMITTED" && (
                <>
                  <Button
                    className="w-full"
                    onClick={() => handleStatusChange("APPROVED")}
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <Loader2 className="size-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle className="size-4 mr-2" />
                    )}
                    Approve
                  </Button>

                  <Dialog>
                    <DialogTrigger
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "w-full"
                      )}
                    >
                      <RotateCcw className="size-4 mr-2" />
                      Request Revision
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Request Revision</DialogTitle>
                      </DialogHeader>
                      <Textarea
                        placeholder="Explain what needs to be changed..."
                        value={revisionComment}
                        onChange={(e) => setRevisionComment(e.target.value)}
                        rows={3}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="destructive"
                          onClick={() => handleStatusChange("REVISION_REQUIRED", revisionComment)}
                          disabled={isUpdating}
                        >
                          Send Revision
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              )}

              {/* Admin: Mark Completed after approval */}
              {userRole === "ADMIN" && task.status === "APPROVED" && (
                <Button
                  className="w-full"
                  onClick={() => handleStatusChange("COMPLETED")}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle className="size-4 mr-2" />
                  )}
                  Mark Completed
                </Button>
              )}

              {/* Employee: Start working */}
              {userRole === "EMPLOYEE" &&
                task.assigned_to === currentUserId &&
                task.status === "TODO" && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleStatusChange("IN_PROGRESS")}
                    disabled={isUpdating}
                  >
                    Start Working
                  </Button>
                )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}