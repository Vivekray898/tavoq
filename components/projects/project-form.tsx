"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import {
  createProjectAction,
  updateProjectAction,
} from "@/lib/actions/projects";
import {
  activeClientsOptions,
  activeEmployeesOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { PROJECT_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { projectSchema, type ProjectInput } from "@/validators/schemas";
import type { Project } from "@/types/database";

interface ProjectFormProps {
  project?: Project;
  mode: "create" | "edit";
}

export function ProjectForm({ project, mode }: ProjectFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);

  // Shared cached dropdown data (§3) — the clients/employees pages hold
  // these entries already; the form reads cache instead of refetching.
  const clientsQuery = useQuery(activeClientsOptions);
  const employeesQuery = useQuery(activeEmployeesOptions);
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const loadingData = clientsQuery.isLoading || employeesQuery.isLoading;

  const [clientId, setClientId] = useState(project?.client_id ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState(project?.status ?? "ACTIVE");
  const [startDate, setStartDate] = useState(project?.start_date ?? "");
  const [endDate, setEndDate] = useState(project?.end_date ?? "");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // §1 — value→label maps so Base UI renders the human-readable name
  // in the trigger (never the raw UUID) after selection or on edit
  // prefill.
  const clientItems = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients]
  );
  const statusItems = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(PROJECT_STATUS_LABELS).filter(([value]) => value !== "ARCHIVED")
      ),
    []
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const input: ProjectInput = {
      client_id: clientId,
      name: name.trim(),
      description,
      status: status as ProjectInput["status"],
      start_date: startDate,
      end_date: endDate,
    };

    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      });
      setErrors(fieldErrors);
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }

    setIsLoading(true);
    const result =
      mode === "create"
        ? await createProjectAction({ ...input, member_ids: memberIds })
        : await updateProjectAction(project!.id, input);

    if (result.success) {
      toast.success(mode === "create" ? "Project created" : "Project updated");
      // Targeted: refresh the project lists (membership may have moved
      // tabs) and patch the edited project's detail from the server row.
      await queryClient.invalidateQueries({
        queryKey: ["projects", "list"],
        refetchType: "active",
      });
      const saved = result.data;
      if (mode === "edit" && saved?.id) {
        queryClient.setQueryData(qk.projectDetail(saved.id), (prev: object | undefined) =>
          prev ? { ...prev, ...saved } : prev
        );
      }
      // §57: after creation, go straight to the project workspace
      router.push(mode === "create" ? `/projects/${result.data?.id}` : `/projects/${project!.id}`);
    } else {
      toast.error(result.error ?? "Something went wrong");
      setIsLoading(false);
    }
  }

  function toggleMember(id: string) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <FieldGroup>
        <Field>
          <FieldLabel>Client *</FieldLabel>
          <Select
            items={clientItems}
            value={clientId}
            onValueChange={(v) => setClientId(v ?? "")}
            disabled={isLoading || loadingData}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingData ? "Loading…" : "Select a client"} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.client_id && <FieldError errors={[{ message: errors.client_id }]} />}
        </Field>

        <Field>
          <FieldLabel htmlFor="name">Project name *</FieldLabel>
          <Input
            id="name"
            placeholder="e.g. September Social Media"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
          />
          {errors.name && <FieldError errors={[{ message: errors.name }]} />}
        </Field>

        <Field>
          <FieldLabel htmlFor="description">Description</FieldLabel>
          <Textarea
            id="description"
            placeholder="What is this project about?"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel>Status</FieldLabel>
            <Select
              items={statusItems}
              value={status}
              onValueChange={(v) => setStatus((v ?? "ACTIVE") as Project["status"])}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROJECT_STATUS_LABELS)
                  .filter(([value]) => value !== "ARCHIVED")
                  .map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="start">Start date</FieldLabel>
            <Input
              id="start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isLoading}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="end">End date</FieldLabel>
            <Input
              id="end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isLoading}
            />
          </Field>
        </div>

        {mode === "create" && employees.length > 0 && (
          <Field>
            <FieldLabel>Team members</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {employees.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => toggleMember(emp.id)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
                    memberIds.includes(emp.id)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {emp.full_name}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Members can see this project and its tasks.
            </p>
          </Field>
        )}
      </FieldGroup>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isLoading || loadingData}>
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {mode === "create" ? "Creating…" : "Saving…"}
            </>
          ) : mode === "create" ? (
            "Create project"
          ) : (
            "Save changes"
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isLoading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
