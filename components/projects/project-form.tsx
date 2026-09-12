"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { projectSchema, type ProjectInput } from "@/validators/schemas";
import {
  createProjectAction,
  updateProjectAction,
} from "@/lib/actions/projects";
import { getActiveClients } from "@/lib/actions/clients";
import { toast } from "sonner";
import { PROJECT_STATUS_LABELS } from "@/lib/constants";
import type { Client, Project } from "@/types/database";

interface ProjectFormProps {
  project?: Project;
  mode: "create" | "edit";
}

export function ProjectForm({ project, mode }: ProjectFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      client_id: project?.client_id ?? "",
      name: project?.name ?? "",
      description: project?.description ?? "",
      status: (project?.status ?? "PLANNING") as ProjectInput["status"],
      start_date: project?.start_date ?? "",
      end_date: project?.end_date ?? "",
    },
  });

  const selectedStatus = watch("status");

  useEffect(() => {
    async function loadClients() {
      const result = await getActiveClients();
      if (result.success && result.data) {
        setClients(result.data);
      }
      setLoadingClients(false);
    }
    loadClients();
  }, []);

  async function onSubmit(data: ProjectInput) {
    setIsLoading(true);

    const result =
      mode === "create"
        ? await createProjectAction(data)
        : await updateProjectAction(project!.id, data);

    if (result.success) {
      toast.success(
        mode === "create" ? "Project created" : "Project updated"
      );
      router.push(mode === "create" ? "/projects" : `/projects/${project!.id}`);
      router.refresh();
    } else {
      toast.error(result.error || "Something went wrong");
    }

    setIsLoading(false);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="client_id">Client *</FieldLabel>
          <Select
            value={watch("client_id") ?? ""}
            onValueChange={(value) => { if (value) setValue("client_id", value); }}
            disabled={isLoading || loadingClients}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors.client_id ? [errors.client_id] : []} />
        </Field>

        <Field>
          <FieldLabel htmlFor="name">Project Name *</FieldLabel>
          <Input
            id="name"
            placeholder="e.g. September Social Media"
            disabled={isLoading}
            {...register("name")}
          />
          <FieldError errors={errors.name ? [errors.name] : []} />
        </Field>

        <Field>
          <FieldLabel htmlFor="description">Description</FieldLabel>
          <Textarea
            id="description"
            placeholder="Describe the project..."
            rows={3}
            disabled={isLoading}
            {...register("description")}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="status">Status</FieldLabel>
          <Select
            value={selectedStatus ?? "PLANNING"}
            onValueChange={(value) => {
              if (value) setValue("status", value as "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED");
            }}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="start_date">Start Date</FieldLabel>
            <Input
              id="start_date"
              type="date"
              disabled={isLoading}
              {...register("start_date")}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="end_date">End Date</FieldLabel>
            <Input
              id="end_date"
              type="date"
              disabled={isLoading}
              {...register("end_date")}
            />
          </Field>
        </div>
      </FieldGroup>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {mode === "create" ? "Creating..." : "Saving..."}
            </>
          ) : mode === "create" ? (
            "Create Project"
          ) : (
            "Save Changes"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
