import { Check, Circle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  LEDGER_STATUS_LABELS,
  LEDGER_STATUS_COLORS,
} from "@/lib/constants";
import type { TaskStatus, ProjectStatus, PaymentStatus } from "@/types/database";
import type { LedgerStatus } from "@/lib/payments/adjustments";

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
  /** Status is never colour alone, but an icon helps at a glance in a
   *  dense table where the label alone is easy to skim past. */
  withIcon?: boolean;
  className?: string;
}

export function PaymentStatusBadge({
  status,
  withIcon = false,
  className,
}: PaymentStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 font-medium", PAYMENT_STATUS_COLORS[status], className)}
    >
      {withIcon && status === "PAID" ? (
        <Check className="size-3" />
      ) : withIcon ? (
        <Circle className="size-2.5 fill-current" />
      ) : null}
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

interface LedgerStatusBadgeProps {
  status: LedgerStatus;
  withIcon?: boolean;
  className?: string;
}

/**
 * Badge for a payments ROW (migration 025), as opposed to a task's
 * payout state.
 *
 * Separate from PaymentStatusBadge because the label sets differ: a
 * ledger row can be CANCELLED and a task never can. Status is never
 * conveyed by colour alone — each state has a distinct word, and the
 * icon repeats it.
 */
export function LedgerStatusBadge({
  status,
  withIcon = false,
  className,
}: LedgerStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 font-medium", LEDGER_STATUS_COLORS[status], className)}
    >
      {withIcon && status === "PAID" ? (
        <Check className="size-3" />
      ) : withIcon && status === "CANCELLED" ? (
        <X className="size-3" />
      ) : withIcon ? (
        <Circle className="size-2.5 fill-current" />
      ) : null}
      {LEDGER_STATUS_LABELS[status]}
    </Badge>
  );
}
