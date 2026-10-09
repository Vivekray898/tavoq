"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field";
import { LABEL_CHIP, LABEL_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface LabelOverShape {
  id: string;
  name: string;
  color: string;
}

const COLOR_OPTIONS: Array<{
  value: keyof typeof LABEL_COLORS;
  label: string;
}> = [
  { value: "GRAY", label: "Gray" },
  { value: "BLUE", label: "Blue" },
  { value: "TEAL", label: "Teal" },
  { value: "GREEN", label: "Green" },
  { value: "AMBER", label: "Amber" },
  { value: "ORANGE", label: "Orange" },
  { value: "RED", label: "Red" },
  { value: "VIOLET", label: "Violet" },
  { value: "PINK", label: "Pink" },
];

interface LabelPickerProps {
  available: LabelOverShape[];
  selectedIds: ReadonlySet<string>;
  canCreate: boolean;
  onCreateLabel: (
    name: string,
    color: keyof typeof LABEL_COLORS,
  ) => Promise<boolean>;
  onToggleLabel?: (labelId: string) => void;
  creatingLabel?: boolean;
  className?: string;
}

/**
 * §19 — reusable label picker for task create / edit.
 *
 * Existing labels come from the shared `labels` query, and newly created
 * ones go through `createLabelAction`, so labels stay database-backed and
 * visible everywhere that reads `labelsOptions` — including task detail,
 * task edit, filters, and the existing `LabelsEditor`.
 */
export function LabelPicker({
  available,
  selectedIds,
  canCreate,
  onCreateLabel,
  onToggleLabel,
  creatingLabel = false,
  className,
}: LabelPickerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<keyof typeof LABEL_COLORS>("BLUE");
  const [nameError, setNameError] = useState<string | null>(null);

  const selected = useMemo(
    () => available.filter((l) => selectedIds.has(l.id)),
    [available, selectedIds],
  );
  const unselected = useMemo(
    () => available.filter((l) => !selectedIds.has(l.id)),
    [available, selectedIds],
  );

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Label name is required");
      return;
    }
    setNameError(null);
    const ok = await onCreateLabel(trimmed, color);
    if (ok) {
      setName("");
      setCreateOpen(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((l) => (
            <span
              key={l.id}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                LABEL_CHIP[l.color as keyof typeof LABEL_CHIP],
              )}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      {unselected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unselected.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onToggleLabel?.(l.id)}
              disabled={!onToggleLabel}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors",
                selectedIds.has(l.id)
                  ? cn(LABEL_CHIP[l.color as keyof typeof LABEL_CHIP]) +
                      " border-transparent"
                  : "border-border bg-background hover:bg-accent/40",
                !selectedIds.has(l.id) && "opacity-70 hover:opacity-100",
              )}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {canCreate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => {
            setName("");
            setColor("BLUE");
            setNameError(null);
            setCreateOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Create label
        </Button>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create label</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="label-name"
                className="mb-1.5 block text-sm font-medium"
              >
                Label name
              </label>
              <Input
                id="label-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder="e.g. Paid social"
                maxLength={30}
                className={cn(
                  nameError && "border-destructive focus:border-destructive",
                )}
              />
              {nameError && (
                <FieldError
                  errors={[{ message: nameError }]}
                  className="mt-1"
                />
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                1–30 characters. Names are case-insensitive and must be unique.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setColor(option.value)}
                    className={cn(
                      "inline-flex items-center justify-center rounded-full p-1 transition-colors",
                      color === option.value && "ring-2 ring-ring",
                    )}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <span
                      className={cn(
                        "h-5 w-5 rounded-full",
                        LABEL_COLORS[option.value],
                      )}
                    />
                  </button>
                ))}
              </div>
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    LABEL_CHIP[color],
                  )}
                >
                  {name || "Label name"}
                </span>
                <span className="ml-auto">Preview</span>
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t p-4 pt-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creatingLabel}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creatingLabel || !name.trim()}
            >
              {creatingLabel && (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              )}
              Create label
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
