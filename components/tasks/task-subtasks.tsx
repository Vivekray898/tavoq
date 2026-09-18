"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { addSubtask, toggleSubtask, deleteSubtask } from "@/lib/actions/task-extras";
import { qk } from "@/lib/queries/keys";
import { cn } from "@/lib/utils";
import type { TaskSubtask } from "@/types/database";

interface SubtasksProps {
  taskId: string;
  initialSubtasks: TaskSubtask[];
  canEdit: boolean;
  onChange?: (subtasks: TaskSubtask[]) => void;
}

/**
 * §21 — lightweight checklist with progress (2/4 completed).
 * Mutations update the shared task-detail cache directly; failures
 * roll back and surface the real error (§24).
 */
export function TaskSubtasks({ taskId, initialSubtasks, canEdit, onChange }: SubtasksProps) {
  const queryClient = useQueryClient();
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>(initialSubtasks);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const done = subtasks.filter((s) => s.done).length;

  function commit(next: TaskSubtask[]) {
    setSubtasks(next);
    onChange?.(next);
  }

  async function handleToggle(s: TaskSubtask) {
    setTogglingId(s.id);
    // Optimistic toggle
    commit(subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)));
    const result = await toggleSubtask(s.id, !s.done);
    setTogglingId(null);
    if (!result.success) {
      commit(subtasks); // rollback
      toast.error(result.error ?? "Couldn't update checklist");
    }
  }

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    const result = await addSubtask(taskId, { title });
    if (result.success && result.data) {
      commit([...subtasks, result.data]);
      setNewTitle("");
      setAdding(false);
    } else {
      toast.error(result.error ?? "Couldn't add item");
    }
  }

  async function handleDelete(id: string) {
    commit(subtasks.filter((s) => s.id !== id));
    const result = await deleteSubtask(id);
    if (!result.success) {
      toast.error(result.error ?? "Couldn't remove item");
      // Targeted recovery: refetch just this task's detail instead of
      // reloading the whole page.
      await queryClient.invalidateQueries({ queryKey: qk.taskDetail(taskId) });
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Checklist
        </h2>
        {subtasks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {done} / {subtasks.length} completed
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        {subtasks.map((s) => (
          <div
            key={s.id}
            className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-accent/40"
          >
            <button
              type="button"
              onClick={() => handleToggle(s)}
              disabled={togglingId === s.id}
              className={cn(
                "flex size-4.5 shrink-0 items-center justify-center rounded border transition-colors",
                s.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40 hover:border-primary"
              )}
              aria-label={s.done ? `Mark "${s.title}" incomplete` : `Complete "${s.title}"`}
            >
              {s.done && <Check className="size-3" />}
            </button>
            <span
              className={cn(
                "flex-1 text-sm",
                s.done ? "text-muted-foreground line-through" : "text-foreground"
              )}
            >
              {s.title}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                aria-label={`Remove "${s.title}"`}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1.5 flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        >
          <Plus className="size-3.5" /> Add item
        </button>
      )}
      {adding && (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") {
                setAdding(false);
                setNewTitle("");
              }
            }}
            placeholder="What needs to be done?"
            className="flex-1 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newTitle.trim()}
            className="text-sm font-medium text-primary disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}
