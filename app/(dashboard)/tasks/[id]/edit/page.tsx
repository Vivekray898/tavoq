import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { getTask } from "@/lib/actions/tasks";
import { PageHeader } from "@/components/shared/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import type { Task } from "@/types/database";

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/tasks");

  const { id } = await params;
  const result = await getTask(id);
  if (!result.success || !result.data) {
    redirect("/tasks");
  }

  const task = {
    ...result.data,
    project_id: (result.data as unknown as { project: { id: string } }).project?.id,
  } as unknown as Task;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit task" />
      <TaskForm mode="edit" task={task} />
    </div>
  );
}
