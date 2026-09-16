"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setTaskLabels } from "@/lib/actions/task-extras";
import { LABEL_CHIP } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Label } from "@/types/database";

interface LabelsEditorProps {
  taskId: string;
  current: Array<{ id: string; name: string; color: string }>;
  allLabels: Label[];
  canEdit: boolean;
  onChange?: (labels: Array<{ id: string; name: string; color: string }>) => void;
}

/** §19 — label chips on the task detail with an add/remove popover. */
export function LabelsEditor({ taskId, current, allLabels, canEdit, onChange }: LabelsEditorProps) {
  const [labels, setLabels] = useState(current);
  const [saving, setSaving] = useState(false);

  const available = allLabels.filter((l) => !labels.some((c) => c.id === l.id));

  async function update(next: Array<{ id: string; name: string; color: string }>) {
    setSaving(true);
    const result = await setTaskLabels(taskId, next.map((l) => l.id));
    setSaving(false);
    if (result.success) {
      setLabels(next);
      onChange?.(next);
    } else {
      toast.error(result.error ?? "Couldn't update labels");
    }
  }

  if (!canEdit && labels.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((l) => (
        <span
          key={l.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            LABEL_CHIP[l.color as keyof typeof LABEL_CHIP] ?? LABEL_CHIP.GRAY
          )}
        >
          {l.name}
          {canEdit && (
            <button
              type="button"
              onClick={() => update(labels.filter((x) => x.id !== l.id))}
              disabled={saving}
              className="rounded-full opacity-60 hover:opacity-100"
              aria-label={`Remove label ${l.name}`}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}

      {canEdit && available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            disabled={saving}
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            Label
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {available.map((l) => (
              <DropdownMenuItem
                key={l.id}
                onClick={() => update([...labels, { id: l.id, name: l.name, color: l.color }])}
              >
                <span
                  className={cn("mr-2 size-2 rounded-full", LABEL_CHIP[l.color]?.split(" ")[0] ?? "bg-gray-400")}
                />
                {l.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
