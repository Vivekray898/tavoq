import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import { getTask } from "@/lib/actions/tasks";

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await getTask(id);

  if (!result.success || !result.data) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Task"
        description="Update task details"
      />
      <TaskForm mode="edit" task={result.data} />
    </div>
  );
}