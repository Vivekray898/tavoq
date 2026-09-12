"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, CheckSquare, List, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { TaskList } from "@/components/tasks/task-list";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonTable } from "@/components/shared/skeleton-loader";
import { getTasks } from "@/lib/actions/tasks";
import type { TaskWithRelations } from "@/types/database";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "kanban">("list");

  useEffect(() => {
    async function load() {
      const result = await getTasks();
      if (result.success && result.data) {
        setTasks(result.data);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Manage and track all tasks"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex border rounded-lg">
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setView("list")}
                className="rounded-r-none"
              >
                <List className="size-4" />
              </Button>
              <Button
                variant={view === "kanban" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setView("kanban")}
                className="rounded-l-none"
              >
                <LayoutGrid className="size-4" />
              </Button>
            </div>
            <Link href="/tasks/new">
              <Button>
                <Plus className="size-4" />
                New Task
              </Button>
            </Link>
          </div>
        }
      />

      {loading ? (
        <SkeletonTable />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Create your first task to start tracking work."
          icon={<CheckSquare className="size-8 text-muted-foreground" />}
          action={{
            label: "New Task",
            href: "/tasks/new",
          }}
        />
      ) : view === "kanban" ? (
        <TaskKanban tasks={tasks} />
      ) : (
        <TaskList tasks={tasks} />
      )}
    </div>
  );
}
