"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";
import { Paperclip, MessageSquare, CheckSquare } from "lucide-react";
import { updateTaskStatus, type TaskListItem } from "@/lib/actions/tasks";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_STATUS_DOTS,
  PRIORITY_DOT,
  LABEL_CHIP,
} from "@/lib/constants";
import { formatDeadline, formatCurrency, isOverdue, cn, getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { TaskStatus } from "@/types/database";

interface BoardProps {
  tasks: TaskListItem[];
  currentUserId: string;
  isAdmin: boolean;
  onChanged?: () => void;
}

/**
 * §7 Kanban board — five status columns, drag-and-drop with optimistic
 * update and rollback on failure. Transitions are validated client-side
 * (mirroring §28) and enforced server-side.
 */
export function BoardView({ tasks, currentUserId, isAdmin, onChanged }: BoardProps) {
  const [items, setItems] = useState<TaskListItem[]>(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-sync when the filtered task set changes (new load / filter).
  // Deferred to a microtask so we don't setState synchronously in the
  // effect body (cascading-render rule).
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setItems(tasks);
    });
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeTask = items.find((t) => t.id === activeId) ?? null;

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const taskId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const task = items.find((t) => t.id === taskId);
    if (!task) return;

    // Dropping onto a column or a task in another column
    let targetStatus: TaskStatus | null = null;
    if (TASK_STATUSES.includes(overId as TaskStatus)) {
      targetStatus = overId as TaskStatus;
    } else {
      const overTask = items.find((t) => t.id === overId);
      if (overTask && overTask.status !== task.status) targetStatus = overTask.status;
    }
    if (!targetStatus || targetStatus === task.status) return;

    // Client-side transition validation (§28)
    const allowed =
      isAdmin
        ? // Admin: SUBMITTED → COMPLETED/REVISION, plus resets back
          (task.status === "SUBMITTED" &&
            (targetStatus === "COMPLETED" || targetStatus === "REVISION_REQUIRED")) ||
          targetStatus === "TODO" ||
          targetStatus === "IN_PROGRESS" ||
          targetStatus === "COMPLETED"
        : task.assigned_to === currentUserId &&
          ((task.status === "TODO" && targetStatus === "IN_PROGRESS") ||
            (task.status === "IN_PROGRESS" && targetStatus === "SUBMITTED") ||
            (task.status === "REVISION_REQUIRED" && targetStatus === "IN_PROGRESS") ||
            (task.status === "REVISION_REQUIRED" && targetStatus === "SUBMITTED"));

    if (!allowed) {
      toast.error(
        isAdmin
          ? `Can't move to ${TASK_STATUS_LABELS[targetStatus]} from ${TASK_STATUS_LABELS[task.status]}`
          : "You can only move your own tasks (To do → In progress → Submitted)"
      );
      return;
    }

    // Optimistic move (§38) — rollback on failure
    const prevStatus = task.status;
    setItems((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus! } : t))
    );

    const result = await updateTaskStatus(taskId, targetStatus);

    if (!result.success) {
      setItems((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: prevStatus } : t))
      );
      toast.error(result.error ?? "Couldn't update the task");
      return;
    }

    if (targetStatus === "COMPLETED") {
      toast.success("Task approved");
    } else if (targetStatus === "SUBMITTED") {
      toast.success("Submitted for review");
    }
    onChanged?.();
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
        {TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={items.filter((t) => t.status === status)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-64 rotate-2 opacity-95">
            <BoardCardContent task={activeTask} overdue={!!activeTask.deadline && isOverdue(activeTask.deadline) && activeTask.status !== "COMPLETED"} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({ status, tasks }: { status: TaskStatus; tasks: TaskListItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex w-64 shrink-0 flex-col lg:w-auto lg:flex-1 lg:min-w-56">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("size-2 rounded-full", TASK_STATUS_DOTS[status])} />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {TASK_STATUS_LABELS[status]}
        </h3>
        <span className="text-xs text-muted-foreground/60">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl bg-muted/40 p-2 transition-colors",
          isOver && "bg-accent/70 ring-1 ring-ring/30"
        )}
      >
        {tasks.map((t) => (
          <BoardCard key={t.id} task={t} />
        ))}
        {tasks.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground/60">
            Drop tasks here
          </p>
        )}
      </div>
    </div>
  );
}

/** Draggable wrapper + card link */
function BoardCard({ task }: { task: TaskListItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn("cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <Link
        href={`/tasks/${task.id}`}
        onClick={(e) => {
          if (isDragging) e.preventDefault();
        }}
        draggable={false}
        className="block rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md"
      >
        <BoardCardContent
          task={task}
          overdue={!!task.deadline && isOverdue(task.deadline) && task.status !== "COMPLETED"}
        />
      </Link>
    </div>
  );
}

/** Card body — also used inside the drag overlay */
function BoardCardContent({
  task,
  overdue,
}: {
  task: TaskListItem;
  overdue: boolean;
}) {
  return (
    <div>
      <p className="text-[13px] font-medium leading-snug text-foreground">
        {task.title}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {task.client_name ? `${task.client_name} · ` : ""}
        {task.project_name}
      </p>

      {task.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((l) => (
            <span
              key={l.id}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                LABEL_CHIP[l.color as keyof typeof LABEL_CHIP] ?? LABEL_CHIP.GRAY
              )}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {task.assigned_name && (
          <Avatar className="size-4.5">
            <AvatarFallback className="text-[7px]">
              {getInitials(task.assigned_name)}
            </AvatarFallback>
          </Avatar>
        )}
        {task.deadline && (
          <span className={cn(overdue && "font-medium text-destructive")}>
            {formatDeadline(task.deadline)}
          </span>
        )}
        {task.payout_amount > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">
            {formatCurrency(task.payout_amount)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {task.subtasks_total > 0 && (
            <span className="flex items-center gap-0.5">
              <CheckSquare className="size-3" />
              {task.subtasks_done}/{task.subtasks_total}
            </span>
          )}
          {task.attachments_count > 0 && (
            <span className="flex items-center gap-0.5">
              <Paperclip className="size-3" />
              {task.attachments_count}
            </span>
          )}
          {task.comments_count > 0 && (
            <span className="flex items-center gap-0.5">
              <MessageSquare className="size-3" />
              {task.comments_count}
            </span>
          )}
          {PRIORITY_DOT[task.priority as keyof typeof PRIORITY_DOT] && (
            <span
              className={cn(
                "size-1.5 rounded-full",
                PRIORITY_DOT[task.priority as keyof typeof PRIORITY_DOT]
              )}
              title={task.priority}
            />
          )}
        </span>
      </div>
    </div>
  );
}
