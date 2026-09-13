// components/tasks/task-form.tsx
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
import { taskSchema, type TaskInput } from "@/validators/schemas";
import { createTaskAction, updateTaskAction, getProjectsForTask } from "@/lib/actions/tasks";
import { getActiveEmployees } from "@/lib/actions/employees";
import { TASK_STATUS_LABELS, PRIORITY_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import type { Task, Profile } from "@/types/database";

interface TaskFormProps {
  task?: Task;
  mode: "create" | "edit";
}

export function TaskForm({ task, mode }: TaskFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; client_name: string }>>([]);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      project_id: task?.project_id ?? "",
      assigned_to: task?.assigned_to ?? "",
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: task?.status ?? "TODO",
      priority: task?.priority ?? "MEDIUM",
      deadline: task?.deadline
        ? new Date(task.deadline).toISOString().slice(0, 16)
        : "",
      payout_amount: task?.payout_amount ?? 0,
      payment_status: task?.payment_status ?? "NOT_APPLICABLE",
    },
  });

  const selectedStatus = watch("status");
  const selectedPriority = watch("priority");
  const selectedPaymentStatus = watch("payment_status");

  useEffect(() => {
    async function loadData() {
      const [projectsResult, employeesResult] = await Promise.all([
        getProjectsForTask(),
        getActiveEmployees(),
      ]);

      if (projectsResult.success && projectsResult.data) {
        setProjects(projectsResult.data);
      }
      if (employeesResult.success && employeesResult.data) {
        setEmployees(employeesResult.data);
      }
      setLoadingData(false);
    }
    loadData();
  }, []);

  async function onSubmit(data: TaskInput) {
    setIsLoading(true);

    const result =
      mode === "create"
        ? await createTaskAction(data)
        : await updateTaskAction(task!.id, data);

    if (result.success) {
      toast.success(mode === "create" ? "Task created" : "Task updated");
      router.push(mode === "create" ? "/tasks" : `/tasks/${task!.id}`);
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
          <FieldLabel htmlFor="project_id">Project *</FieldLabel>
          <Select
            value={watch("project_id") ?? ""}
            onValueChange={(value) => { if (value) setValue("project_id", value); }}
            disabled={isLoading || loadingData}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name} — {project.client_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors.project_id ? [errors.project_id] : []} />
        </Field>

        <Field>
          <FieldLabel htmlFor="title">Task Title *</FieldLabel>
          <Input
            id="title"
            placeholder="e.g. Create 5 Instagram Posts"
            disabled={isLoading}
            {...register("title")}
          />
          <FieldError errors={errors.title ? [errors.title] : []} />
        </Field>

        <Field>
          <FieldLabel htmlFor="description">Description</FieldLabel>
          <Textarea
            id="description"
            placeholder="Describe what needs to be done..."
            rows={4}
            disabled={isLoading}
            {...register("description")}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="assigned_to">Assigned To</FieldLabel>
          <Select
            value={watch("assigned_to") ?? ""}
            onValueChange={(value) => setValue("assigned_to", value || "")}
            disabled={isLoading || loadingData}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select an employee" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="deadline">Deadline</FieldLabel>
            <Input
              id="deadline"
              type="datetime-local"
              disabled={isLoading}
              {...register("deadline")}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="payout_amount">Payout (₹)</FieldLabel>
            <Input
              id="payout_amount"
              type="number"
              min="0"
              step="50"
              placeholder="0"
              disabled={isLoading}
              {...register("payout_amount", { valueAsNumber: true })}
            />
            <FieldError errors={errors.payout_amount ? [errors.payout_amount] : []} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field>
            <FieldLabel>Priority</FieldLabel>
            <Select
              value={selectedPriority ?? "MEDIUM"}
              onValueChange={(value) => {
                if (value) setValue("priority", value as TaskInput["priority"]);
              }}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {mode === "edit" && (
            <>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={selectedStatus ?? "TODO"}
                  onValueChange={(value) => {
                    if (value) setValue("status", value as TaskInput["status"]);
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Payment</FieldLabel>
                <Select
                  value={selectedPaymentStatus ?? "NOT_APPLICABLE"}
                  onValueChange={(value) => {
                    if (value) setValue("payment_status", value as TaskInput["payment_status"]);
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}
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
            "Create Task"
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
