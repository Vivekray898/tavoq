"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/utils";

interface SubmitTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (note?: string) => Promise<void>;
  /** Called for each file the user attached; runs before submission */
  onFileSelected?: (file: File) => Promise<boolean>;
  title: string;
  submitLabel?: string;
}

/**
 * §14 — submission is a first-class action: add a note, attach the
 * completed files, then submit.
 */
export function SubmitTaskDialog({
  open,
  onClose,
  onSubmit,
  onFileSelected,
  title,
  submitLabel = "Submit for review",
}: SubmitTaskDialogProps) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [working, setWorking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setNote("");
    setFiles([]);
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (files.some((f) => f.name === file.name && f.size === file.size)) return;
    setFiles((prev) => [...prev, file]);
  }

  async function handleSubmit() {
    setWorking(true);
    try {
      // Upload files first; abort submission if any fails
      for (const file of files) {
        if (onFileSelected) {
          const ok = await onFileSelected(file);
          if (!ok) {
            setWorking(false);
            return;
          }
        }
      }
      await onSubmit(note.trim() || undefined);
      reset();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Add a note</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the reviewer should know…"
              rows={3}
              className="mt-1.5"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Attach completed files</label>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={handleFilePicked}
              accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4,.mov,.zip,.txt,.docx,.xlsx,.pptx"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            >
              <Paperclip className="size-4" /> Choose files
            </button>

            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-sm"
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatFileSize(f.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={working}>
            {working && <Loader2 className="size-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
