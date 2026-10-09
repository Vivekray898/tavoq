"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
  FieldDescription,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { createTaskAction, updateTaskAction } from "@/lib/actions/tasks";
import {
  projectsForTaskOptions,
  activeEmployeesOptions,
  labelsOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { LABEL_COLORS } from "@/lib/constants";
import { taskSchema, type TaskInput } from "@/validators/schemas";
import type { Task } from "@/types/database";
import type { Label } from "@/types/database";
import { createLabelAction } from "@/lib/actions/task-extras";
import type { TaskDetail } from "@/lib/actions/tasks";
import { LabelPicker } from "./label-picker";

interface TaskFormProps {
  task?: Task;
  mode: "create" | "edit";
}

/** Combine IST date + time inputs into a UTC ISO instant (§29). */
function toISTInstant(dateStr: string, timeStr: string): string {
  if (!dateStr) return "";
  const t = timeStr || "18:00";
  return new Date(`${dateStr}T${t}:00+05:30`).toISOString();
}

function fromISTInstant(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const ist = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => ist.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

const PRIORITY_OPTIONS: Array<{ value: TaskInput["priority"]; label: string }> =
  [
    { value: "NONE", label: "None" },
    { value: "LOW", label: "Low" },
    { value: "MEDIUM", label: "Medium" },
    { value: "HIGH", label: "High" },
    { value: "URGENT", label: "Urgent" },
  ];

type LocalSubtask = { id?: string; title: string; done: boolean };

export function TaskForm({ task, mode }: TaskFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);

  const projectsQuery = useQuery(projectsForTaskOptions);
  const employeesQuery = useQuery(activeEmployeesOptions);
  const labelsQuery = useQuery(labelsOptions);
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const employees = useMemo(
    () => employeesQuery.data ?? [],
    [employeesQuery.data],
  );
  const labels = useMemo(() => labelsQuery.data ?? [], [labelsQuery.data]);
  const loadingData = projectsQuery.isLoading || employeesQuery.isLoading;

  const [projectId, setProjectId] = useState(
    task?.project_id ?? searchParams.get("project") ?? "",
  );
  const [assignedTo, setAssignedTo] = useState(
    task?.assigned_to ?? searchParams.get("assignee") ?? "",
  );
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskInput["priority"]>(
    (task?.priority as TaskInput["priority"]) ?? "MEDIUM",
  );
  const initial = fromISTInstant(task?.deadline ?? null);
  const [dueDate, setDueDate] = useState(initial.date);
  const [dueTime, setDueTime] = useState(initial.time || "18:00");
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(
    new Set(),
  );
  const [subtasks, setSubtasks] = useState<LocalSubtask[]>(
    mode === "edit" && task
      ? ((task as TaskDetail).subtasks?.map((s) => ({
          id: s.id,
          title: s.title,
          done: s.done,
        })) ?? [])
      : [],
  );
  const [newSubtask, setNewSubtask] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedLabelIdsSet = useMemo(
    () => selectedLabelIds,
    [selectedLabelIds],
  );

  const projectItems = useMemo(
    () =>
      Object.fromEntries(
        projects.map((p) => [
          p.id,
          p.client_name ? `${p.client_name} — ${p.name}` : p.name,
        ]),
      ),
    [projects],
  );
  const employeeItems = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e.full_name])),
    [employees],
  );

  async function onCreateLabel(
    name: string,
    color: keyof typeof LABEL_COLORS,
  ): Promise<boolean> {
    const result = await createLabelAction({ name, color });
    if (!result.success || !result.data) {
      toast.error(result.error ?? "Couldn't create the label");
      return false;
    }
    setSelectedLabelIds((prev) => new Set(prev).add(result.data!.id));
    toast.success("Label created");
    return true;
  }

  function toggleLabel(labelId: string) {
    setSelectedLabelIds((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  }

  function addSubtask() {
    const t = newSubtask.trim();
    if (!t) return;
    setSubtasks((prev) => [...prev, { title: t, done: false }]);
    setNewSubtask("");
  }

  function removeSubtask(index: number) {
    setSubtasks((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const deadline = toISTInstant(dueDate, dueTime);
    const cleanSubtasks = subtasks.map((s) => s.title.trim()).filter(Boolean);

    const input: TaskInput = {
      project_id: projectId,
      assigned_to: assignedTo || "",
      title: title.trim(),
      description: description || undefined,
      priority: priority as TaskInput["priority"],
      deadline: deadline || undefined,
      label_ids:
        selectedLabelIds.size > 0 ? Array.from(selectedLabelIds) : undefined,
      subtasks:
        cleanSubtasks.length > 0
          ? cleanSubtasks.map((t) => ({ title: t }))
          : undefined,
      ...(mode === "edit" ? { status: task?.status } : {}),
    };

    const parsed = taskSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      });
      setErrors(fieldErrors);
      if (fieldErrors.title) toast.error(fieldErrors.title);
      return;
    }

    setIsLoading(true);
    const result =
      mode === "create"
        ? await createTaskAction(input)
        : await updateTaskAction(task!.id, input);

    if (result.success) {
      toast.success(mode === "create" ? "Task created" : "Task updated");
      if (mode === "edit" && task) {
        queryClient.invalidateQueries({
          queryKey: qk.taskDetail(task.id),
          refetchType: "active",
        });
      }
      router.push(
        mode === "create" ? `/tasks/${result.data?.id}` : `/tasks/${task!.id}`,
      );
    } else {
      toast.error(result.error ?? "Something went wrong");
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ── Task details ──────────────────────────────────────────── */}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="title">Task title *</FieldLabel>
          <Input
            id="title"
            placeholder="e.g. Create 5 Instagram posts for ABC Restaurant"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
          {errors.title && <FieldError errors={[{ message: errors.title }]} />}
        </Field>

        <Field>
          <FieldLabel htmlFor="description">
            Description / instructions
          </FieldLabel>
          <Textarea
            id="description"
            placeholder="Requirements, brand rules, links, expected deliverables…"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
          />
          {errors.description && (
            <FieldError errors={[{ message: errors.description }]} />
          )}
        </Field>
      </FieldGroup>

      <Separator />

      {/* ── Assignment ────────────────────────────────────────────── */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel>Project *</FieldLabel>
          <Select
            items={projectItems}
            value={projectId}
            onValueChange={(v) => setProjectId(v ?? "")}
            disabled={isLoading || loadingData}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={loadingData ? "Loading…" : "Select a project"}
              />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.client_name ? `${p.client_name} — ${p.name}` : p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.project_id && (
            <FieldError errors={[{ message: errors.project_id }]} />
          )}
        </Field>

        <Field>
          <FieldLabel>Assign to</FieldLabel>
          <Select
            items={employeeItems}
            value={assignedTo}
            onValueChange={(v) => setAssignedTo(v ?? "")}
            disabled={isLoading || loadingData}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={loadingData ? "Loading…" : "Select an employee"}
              />
            </SelectTrigger>
            <SelectContent>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.assigned_to && (
            <FieldError errors={[{ message: errors.assigned_to }]} />
          )}
        </Field>
      </div>

      <Separator />

      {/* ── Scheduling ────────────────────────────────────────────── */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="dueDate">Due date</FieldLabel>
          <Input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={isLoading}
          />
          {errors.deadline && (
            <FieldError errors={[{ message: errors.deadline }]} />
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="dueTime">Due time</FieldLabel>
          <Input
            id="dueTime"
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            disabled={isLoading || !dueDate}
          />
          <FieldDescription>
            Optional. Leave blank for an all-day task.
          </FieldDescription>
        </Field>
      </div>

      <Separator />

      {/* ── Priority ──────────────────────────────────────────────── */}
      <Field>
        <FieldLabel>Priority</FieldLabel>
        <Select
          items={Object.fromEntries(
            PRIORITY_OPTIONS.map((o) => [o.value, o.label]),
          )}
          value={priority}
          onValueChange={(v) =>
            setPriority((v ?? "MEDIUM") as TaskInput["priority"])
          }
          disabled={isLoading}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Separator />

      {/* ── Labels ────────────────────────────────────────────────── */}
      <Field>
        <FieldLabel>Labels</FieldLabel>
        {loadingData ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading labels…
          </div>
        ) : labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No labels yet. Staff can create labels below.
          </p>
        ) : (
          <LabelPicker
            available={labels as unknown as Label[]}
            selectedIds={selectedLabelIdsSet}
            canCreate={true}
            onCreateLabel={onCreateLabel}
            onToggleLabel={toggleLabel}
            creatingLabel={isLoading}
          />
        )}
      </Field>

      <Separator />

      {/* ── Checklist ─────────────────────────────────────────────── */}
      <Field>
        <FieldLabel>Checklist / subtasks</FieldLabel>
        <FieldDescription>
          Add the steps your teammate can tick off. Checklist items are not
          separate assigned tasks.
        </FieldDescription>

        {subtasks.length > 0 ? (
          <div className="mt-3 space-y-1">
            {subtasks.map((subtask, index) => (
              <div
                key={subtask.id ?? `new-${index}`}
                className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
              >
                <Input
                  value={subtask.title}
                  onChange={(e) => {
                    setSubtasks((prev) =>
                      prev.map((s, i) =>
                        i === index ? { ...s, title: e.target.value } : s,
                      ),
                    );
                  }}
                  disabled={isLoading}
                  className="flex-1 font-normal shadow-none focus:ring-2 focus:ring-ring/50"
                  aria-label={`Checklist item ${index + 1}`}
                />
                {mode === "edit" && subtask.id && (
                  <Checkbox
                    checked={subtask.done}
                    onCheckedChange={(checked) =>
                      setSubtasks((prev) =>
                        prev.map((s, i) =>
                          i === index ? { ...s, done: !!checked } : s,
                        ),
                      )
                    }
                    disabled={isLoading}
                    aria-label={`Mark “${subtask.title}” complete`}
                    className="shrink-0 mt-0.5"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeSubtask(index)}
                  disabled={isLoading}
                  aria-label="Remove checklist item"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No checklist items yet.
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Input
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addSubtask();
              }
            }}
            placeholder="Add a checklist item…"
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSubtask}
            disabled={isLoading || !newSubtask.trim()}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </Field>

      <Separator />

      {/* ── Actions ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading || loadingData}>
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {mode === "create" ? "Creating…" : "Saving…"}
            </>
          ) : mode === "create" ? (
            "Create task"
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </form>
  );
}
