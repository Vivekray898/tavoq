import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { TaskForm } from "@/components/tasks/task-form";

export default async function NewTaskPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  // Staff-only surface: super admin or manager. Managers are
  // additionally scoped to their own projects inside the actions.
  if (profile.role !== "SUPER_ADMIN" && profile.role !== "MANAGER") redirect("/tasks");

  return (
    <div className="space-y-6">
      <PageHeader title="New task" description="Assign work to your team" />
      <TaskForm mode="create" />
    </div>
  );
}
