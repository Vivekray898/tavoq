import Link from "next/link";
import { Calendar, IndianRupee } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TaskStatusBadge } from "@/components/shared/status-badge";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDate, getInitials, isOverdue, isDueToday, cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/database";

interface TaskListProps {
  tasks: TaskWithRelations[];
}

export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No tasks found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead className="hidden sm:table-cell">Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Priority</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead className="hidden sm:table-cell">Payout</TableHead>
            <TableHead className="hidden lg:table-cell">Assigned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const overdue = isOverdue(task.deadline);
            const dueToday = isDueToday(task.deadline);
            const assignedUser = (task as unknown as { assigned_user?: { full_name?: string; avatar_url?: string | null } }).assigned_user;

            return (
              <TableRow key={task.id}>
                <TableCell>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="font-medium hover:underline text-sm"
                  >
                    {task.title}
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                  {(task.project as unknown as { name?: string })?.name || "—"}
                </TableCell>
                <TableCell>
                  <TaskStatusBadge status={task.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <PriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell>
                  {task.deadline ? (
                    <span
                      className={cn(
                        "text-sm flex items-center gap-1",
                        overdue && "text-red-600 font-medium",
                        dueToday && !overdue && "text-orange-600 font-medium"
                      )}
                    >
                      <Calendar className="size-3" />
                      {formatDate(task.deadline)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {task.payout_amount > 0 ? (
                    <span className="text-sm text-green-600 flex items-center gap-1">
                      <IndianRupee className="size-3" />
                      {task.payout_amount}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {assignedUser?.full_name ? (
                    <div className="flex items-center gap-2">
                      <Avatar className="size-5">
                        <AvatarFallback className="text-[8px]">
                          {getInitials(assignedUser.full_name || "")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{assignedUser.full_name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
