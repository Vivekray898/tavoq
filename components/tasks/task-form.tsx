"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronDown } from "lucide-react";
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
  createTaskAction,
  updateTaskAction,
} from "@/lib/actions/tasks";
import {
  projectsForTaskOptions,
  activeEmployeesOptions,
  labelsOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { LABEL_CHIP, PRIORITY_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { taskSchema, type TaskInput } from "@/validators/schemas";
import type { Task } from "@/types/database";

interface TaskFormProps {
  task?: Task;
  mode: "create" | "edit";
}

/** Combine IST date + time inputs into a UTC ISO instant (§29). */
function toISTInstant(dateStr: string, timeStr: string): string {
  if (!dateStr) return "";
  // dateStr: "2026-09-18", timeStr: "18:00"
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
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

export function TaskForm({ task, mode }: TaskFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);

  // Dropdown data comes from the shared cache (§3): the tasks page and
  // quick-add already hold projects/employees/labels, so opening this
  // form usually costs zero requests and never refetches fresh cache.
  const projectsQuery = useQuery(projectsForTaskOptions);
  const employeesQuery = useQuery(activeEmployeesOptions);
  const labelsQuery = useQuery(labelsOptions);
  const projects = projectsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const labels = labelsQuery.data ?? [];
  const loadingData = projectsQuery.isLoading || employeesQuery.isLoading;

  const [moreOpen, setMoreOpen] = useState(mode === "edit");

  const [projectId, setProjectId] = useState(
    task?.project_id ?? searchParams.get("project") ?? ""
  );
  const [assignedTo, setAssignedTo] = useState(
    task?.assigned_to ?? searchParams.get("assignee") ?? ""
  );
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "MEDIUM");
  const [payout, setPayout] = useState(
    task?.payout_amount ? String(Number(task.payout_amount)) : ""
  );
  const initial = fromISTInstant(task?.deadline ?? null);
  const [dueDate, setDueDate] = useState(initial.date);
  const [dueTime, setDueTime] = useState(initial.time || "18:00");
  const [paymentStatus, setPaymentStatus] = useState(task?.payment_status ?? "NOT_APPLICABLE");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    // Edit mode: prefill from existing labels if the caller provided them
    []
  );
  const [subtaskLines, setSubtaskLines] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const deadline = toISTInstant(dueDate, dueTime);
    const subtasks = subtaskLines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((t) => ({ title: t }));
    const input: TaskInput = {
      project_id: projectId,
      assigned_to: assignedTo || "",
      title: title.trim(),
      description,
      priority: priority as TaskInput["priority"],
      deadline,
      payout_amount: payout ? Number(payout) : 0,
      payment_status: paymentStatus,
      label_ids: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
      subtasks: subtasks.length > 0 ? subtasks : undefined,
      ...(mode === "edit" ? { status: task?.status } : {}),
    };

    // Client-side validation
    const parsed = taskSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      });
      setErrors(fieldErrors);
      if (fieldErrors.title) {
        toast.error(fieldErrors.title);
      }
      return;
    }

    setIsLoading(true);
    const result =
      mode === "create"
        ? await createTaskAction(input)
        : await updateTaskAction(task!.id, input);

    if (result.success) {
      toast.success(mode === "create" ? "Task created" : "Task updated");
      // The created/updated task reaches every list via realtime + the
      // targeted invalidation the tasks page owns; nothing broader runs.
      if (mode === "edit" && task) {
        queryClient.invalidateQueries({ queryKey: qk.taskDetail(task.id), refetchType: "active" });
      }
      router.push(mode === "create" ? `/tasks/${result.data?.id}` : `/tasks/${task!.id}`);
    } else {
      toast.error(result.error ?? "Something went wrong");
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="title">Task title *</FieldLabel>
          <Input
            id="title"
            placeholder="e.g. Create 5 Instagram posts"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
          {errors.title && <FieldError errors={[{ message: errors.title }]} />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>Project *</FieldLabel>
            <Select
              value={projectId}
              onValueChange={(v) => setProjectId(v ?? "")}
              disabled={isLoading || loadingData}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingData ? "Loading…" : "Select a project"} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.client_name ? `${p.client_name} — ${p.name}` : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.project_id && <FieldError errors={[{ message: errors.project_id }]} />}
          </Field>

          <Field>
            <FieldLabel>Assign to</FieldLabel>
            <Select
              value={assignedTo}
              onValueChange={(v) => setAssignedTo(v ?? "")}
              disabled={isLoading || loadingData}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingData ? "Loading…" : "Select an employee"} />
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
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="dueDate">Due date</FieldLabel>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isLoading}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="dueTime">Time</FieldLabel>
            <Input
              id="dueTime"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              disabled={isLoading || !dueDate}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">        <Field>
          <FieldLabel>Priority</FieldLabel>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(((v ?? "MEDIUM") as TaskInput["priority"]) ?? "MEDIUM")}
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

          <Field>
            <FieldLabel htmlFor="payout">Payout (₹)</FieldLabel>
            <Input
              id="payout"
              type="number"
              min="0"
              step="50"
              placeholder="0"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              disabled={isLoading}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="description">Instructions</FieldLabel>
          <Textarea
            id="description"
            placeholder="What exactly needs to be done? Requirements, brand rules, links to use…"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
          />
        </Field>
      </FieldGroup>

      {/* More options (§19) */}
      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        More options
        <ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} />
      </button>

      {moreOpen && (
        <div className="space-y-5">
          {/* Labels (§19) */}
          {labels.length > 0 && (
            <Field>
              <FieldLabel>Labels</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {labels.map((l) => {
                  const active = selectedLabelIds.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        setSelectedLabelIds((prev) =>
                          prev.includes(l.id)
                            ? prev.filter((id) => id !== l.id)
                            : [...prev, l.id]
                        )
                      }
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium transition-opacity",
                        LABEL_CHIP[l.color],
                        !active && "opacity-40 hover:opacity-70"
                      )}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {/* Subtasks (§21) — one per line */}
          <Field>
            <FieldLabel htmlFor="subtasks">Checklist</FieldLabel>
            <Textarea
              id="subtasks"
              placeholder={"One item per line, e.g.\nWrite caption\nDesign post\nExport files"}
              rows={3}
              value={subtaskLines.join("\n")}
              onChange={(e) => setSubtaskLines(e.target.value.split("\n"))}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Creates a checklist on the task your teammate can tick off.
            </p>
          </Field>

          <Field>
            <FieldLabel>Payment status</FieldLabel>
            <Select
              value={paymentStatus}
              onValueChange={(v) => setPaymentStatus(((v ?? "NOT_APPLICABLE") as TaskInput["payment_status"]) ?? "NOT_APPLICABLE")}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_APPLICABLE">No payout</SelectItem>
                <SelectItem value="PENDING">Payment pending</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Tasks with a payout are automatically marked pending payment on completion.
            </p>
          </Field>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
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
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
