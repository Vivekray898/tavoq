import Link from "next/link";
import { Paperclip, MessageSquare, CheckSquare } from "lucide-react";
import { cn, formatDeadline, isOverdue } from "@/lib/utils";
import { StatusDot, PriorityTag } from "@/components/shared/status-dot";
import { LABEL_CHIP } from "@/lib/constants";
import type { TaskStatus } from "@/types/database";

export interface TaskCardLabel {
  id: string;
  name: string;
  color: string;
}

interface TaskCardProps {
  href: string;
  title: string;
  subtitle?: string | null;
  projectName?: string | null;
  status?: TaskStatus;
  priority?: string;
  deadline?: string | null;
  assignedName?: string | null;
  labels?: TaskCardLabel[];
  subtasksDone?: number;
  subtasksTotal?: number;
  commentsCount?: number;
  attachmentsCount?: number;
  compact?: boolean;
  className?: string;
}

/**
 * Progressive disclosure (§3.3): title + project + due date on the
 * card; everything else lives behind the tap.
 */
export function TaskCard({
  href,
  title,
  subtitle,
  projectName,
  status,
  priority,
  deadline,
  assignedName,
  labels,
  subtasksDone = 0,
  subtasksTotal = 0,
  commentsCount = 0,
  attachmentsCount = 0,
  compact,
  className,
}: TaskCardProps) {
  const overdue = deadline ? isOverdue(deadline) : false;
  const meta: string[] = [];
  if (deadline) meta.push(formatDeadline(deadline));

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-xl border bg-card px-4 py-3.5 transition-colors hover:bg-accent/50",
        compact && "py-3",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium leading-snug text-foreground">
            {title}
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {subtitle ?? projectName ?? ""}
            {subtitle && projectName ? ` · ${projectName}` : ""}
          </p>
          {labels && labels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {labels.slice(0, 3).map((l) => (
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
        </div>
        {status && <StatusDot status={status} className="mt-0.5 shrink-0" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {meta.map((m, i) => (
          <span
            key={i}
            className={cn(
              "text-xs",
              overdue && i === 0
                ? "font-medium text-destructive"
                : "text-muted-foreground"
            )}
          >
            {m}
          </span>
        ))}
        <PriorityTag priority={priority ?? ""} />
        {subtasksTotal > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <CheckSquare className="size-3" />
            {subtasksDone}/{subtasksTotal}
          </span>
        )}
        {attachmentsCount > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Paperclip className="size-3" />
            {attachmentsCount}
          </span>
        )}
        {commentsCount > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <MessageSquare className="size-3" />
            {commentsCount}
          </span>
        )}
        {assignedName && (
          <span className="ml-auto text-xs text-muted-foreground">{assignedName}</span>
        )}
      </div>
    </Link>
  );
}
