"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTaskAction } from "@/lib/actions/tasks";
import { getProjectsForTask } from "@/lib/actions/tasks";
import { getActiveEmployees } from "@/lib/actions/employees";
import { cn } from "@/lib/utils";
import type { TaskListItem } from "@/lib/actions/tasks";

interface QuickAddTaskProps {
  /** Preselected project (e.g. launched from a project workspace) */
  projectId?: string;
  className?: string;
  /** Shown after creation */
  onCreated?: (task: TaskListItem) => void;
}

interface ProjectOption {
  id: string;
  name: string;
  client_name: string;
}

interface EmployeeOption {
  id: string;
  full_name: string;
}

/**
 * §10 — ultra-fast task creation: title, project, assignee, due date.
 * Everything else lives in the full form behind "More options".
 */
export function QuickAddTask({ projectId, className, onCreated }: QuickAddTaskProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedProject, setSelectedProject] = useState(projectId ?? "");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openComposer() {
    setOpen(true);
    if (!projects.length || !employees.length) {
      setLoadingOptions(true);
      const [projRes, empRes] = await Promise.all([
        getProjectsForTask(),
        getActiveEmployees(),
      ]);
      if (projRes.success && projRes.data) setProjects(projRes.data);
      if (empRes.success && empRes.data) setEmployees(empRes.data);
      setLoadingOptions(false);
    }
  }

  function close() {
    setOpen(false);
    setTitle("");
    setDueDate("");
    setError(null);
    if (!projectId) setSelectedProject("");
    setSelectedEmployee("");
  }

  async function submit() {
    if (!title.trim() || !selectedProject) return;
    setSaving(true);
    setError(null);

    // IST 6:00 PM default time when only a date is picked
    let deadline: string | undefined;
    if (dueDate) {
      deadline = new Date(`${dueDate}T18:00:00+05:30`).toISOString();
    }

    const result = await createTaskAction({
      project_id: selectedProject,
      title: title.trim(),
      assigned_to: selectedEmployee || undefined,
      deadline,
    });

    setSaving(false);
    if (result.success && result.data) {
      close();
      onCreated?.(result.data as unknown as TaskListItem);
      // No router.refresh — the parent list updates via targeted
      // invalidation; realtime also patches other open clients.
    } else {
      setError(result.error ?? "Couldn't create the task");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openComposer}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-ring hover:bg-accent/40 hover:text-foreground",
          className
        )}
      >
        <Plus className="size-4" />
        Add task
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") close();
          }}
          placeholder="Task title"
          className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={close}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {loadingOptions ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <Select value={selectedProject || undefined} onValueChange={(v) => setSelectedProject(v ?? "")}>
              <SelectTrigger size="sm" className="h-7 w-auto min-w-40 text-xs">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.client_name ? `${p.client_name} — ` : ""}
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedEmployee || undefined} onValueChange={(v) => setSelectedEmployee(v ?? "")}>
              <SelectTrigger size="sm" className="h-7 w-auto min-w-32 text-xs">
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-7 rounded-md border bg-transparent px-2 text-xs outline-none"
              aria-label="Due date"
            />
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={submit} disabled={saving || !title.trim() || !selectedProject}>
            {saving && <Loader2 className="size-3 animate-spin" />}
            Create
          </Button>
        </div>
      </div>      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Need payout, priority or instructions?{" "}
        <Link href="/tasks/new" className="underline hover:text-foreground">
          Use the full form
        </Link>
      </p>
    </div>
  );
}
