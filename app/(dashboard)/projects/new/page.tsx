import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectForm } from "@/components/projects/project-form";

export default async function NewProjectPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/projects");

  return (
    <div className="space-y-6">
      <PageHeader title="New project" description="Create a workspace for a client's work" />
      <ProjectForm mode="create" />
    </div>
  );
}
