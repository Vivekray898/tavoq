import { PageHeader } from "@/components/shared/page-header";
import { TaskForm } from "@/components/tasks/task-form";

export default function NewTaskPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New Task"
        description="Create a new task and assign it"
      />
      <TaskForm mode="create" />
    </div>
  );
}
