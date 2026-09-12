import Link from "next/link";
import { Calendar, IndianRupee } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TaskStatusBadge } from "@/components/shared/status-badge";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { formatDate, getInitials, isOverdue, isDueToday, cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/database";

interface TaskCardProps {
  task: TaskWithRelations;
}

export function TaskCard({ task }: TaskCardProps) {
  const overdue = isOverdue(task.deadline);
  const dueToday = isDueToday(task.deadline);

  return (
    <Link href={`/tasks/${task.id}`}>
      <Card className="hover:shadow-sm transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate text-sm">{task.title}</h3>
              {task.project && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {(task.project as unknown as { name?: string }).name}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {task.deadline && (
                <span
                  className={cn(
                    "flex items-center gap-1",
                    overdue && "text-red-600 font-medium",
                    dueToday && !overdue && "text-orange-600 font-medium"
                  )}
                >
                  <Calendar className="size-3" />
                  {formatDate(task.deadline)}
                </span>
              )}
              {task.payout_amount > 0 && (
                <span className="flex items-center gap-1 text-green-600">
                  <IndianRupee className="size-3" />
                  {task.payout_amount}
                </span>
              )}
            </div>
            {(task as unknown as { assigned_user?: { full_name?: string } }).assigned_user && (
              <Avatar className="size-5">
                <AvatarFallback className="text-[8px]">
                  {getInitials(
                    (task as unknown as { assigned_user: { full_name: string } }).assigned_user.full_name
                  )}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
