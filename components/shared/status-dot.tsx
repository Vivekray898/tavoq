import { cn } from "@/lib/utils";
import {
  TASK_STATUS_DOTS,
  TASK_STATUS_LABELS,
} from "@/lib/constants";
import type { TaskStatus } from "@/types/database";

interface StatusDotProps {
  status: TaskStatus;
  className?: string;
}

/** Subtle status indicator (§11): small colored dot + neutral label */
export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", TASK_STATUS_DOTS[status])}
        aria-hidden
      />
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

interface PriorityTagProps {
  priority: string;
  className?: string;
}

/** Only surfaced for high/urgent priorities */
export function PriorityTag({ priority, className }: PriorityTagProps) {
  if (priority !== "HIGH" && priority !== "URGENT") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        priority === "URGENT"
          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
          : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
        className
      )}
    >
      {priority === "URGENT" ? "Urgent" : "High priority"}
    </span>
  );
}
