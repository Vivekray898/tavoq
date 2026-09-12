import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PRIORITY_LABELS, PRIORITY_COLORS } from "@/lib/constants";
import type { TaskPriority } from "@/types/database";

interface PriorityBadgeProps {
  priority: TaskPriority;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn("font-medium", PRIORITY_COLORS[priority], className)}
    >
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}
