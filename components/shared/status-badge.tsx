import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
} from "@/lib/constants";
import type { TaskStatus, ProjectStatus, PaymentStatus } from "@/types/database";

interface TaskStatusBadgeProps {
  status: TaskStatus;
  className?: string;
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn("font-medium", TASK_STATUS_COLORS[status], className)}
    >
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  className?: string;
}

export function ProjectStatusBadge({ status, className }: ProjectStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn("font-medium", PROJECT_STATUS_COLORS[status], className)}
    >
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
  className?: string;
}

export function PaymentStatusBadge({ status, className }: PaymentStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn("font-medium", PAYMENT_STATUS_COLORS[status], className)}
    >
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
