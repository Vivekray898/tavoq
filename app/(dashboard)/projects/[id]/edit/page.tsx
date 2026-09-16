import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { getProject } from "@/lib/actions/projects";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import type { Project } from "@/types/database";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/projects");

  const { id } = await params;
  const result = await getProject(id);
  if (!result.success || !result.data) {
    redirect("/projects");
  }

  const task = {
    ...result.data,
  } as unknown as Project;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit project" />
      <ProjectForm mode="edit" project={task} />
    </div>
  );
}
