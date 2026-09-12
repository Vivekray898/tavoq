import { TaskCard } from "./task-card";
import { KANBAN_COLUMNS } from "@/lib/constants";
import { TASK_STATUS_LABELS } from "@/lib/constants";
import type { TaskWithRelations } from "@/types/database";

interface TaskKanbanProps {
  tasks: TaskWithRelations[];
}

export function TaskKanban({ tasks }: TaskKanbanProps) {
  const tasksByStatus = KANBAN_COLUMNS.map((status) => ({
    status,
    label: TASK_STATUS_LABELS[status],
    tasks: tasks.filter((t) => t.status === status),
  }));

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {tasksByStatus.map((column) => (
        <div
          key={column.status}
          className="flex-shrink-0 w-72 bg-muted/50 rounded-lg p-3"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-foreground">
              {column.label}
            </h3>
            <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">
              {column.tasks.length}
            </span>
          </div>

          <div className="space-y-2">
            {column.tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No tasks
              </p>
            ) : (
              column.tasks.map((task) => <TaskCard key={task.id} task={task} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
