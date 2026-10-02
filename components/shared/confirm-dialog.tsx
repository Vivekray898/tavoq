"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Confirmation for destructive or irreversible actions.
 *
 * Wraps the existing Dialog rather than introducing a second overlay,
 * so focus trapping, Esc-to-close and the overlay animation stay
 * consistent with every other dialog in the app.
 *
 * The confirm button shows a pending state and is disabled while the
 * action is in flight, so a slow mutation cannot be submitted twice.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Label for the confirming action. Plain verb, e.g. "Delete client". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get the danger treatment. */
  destructive?: boolean;
  /** Optional body between the description and the buttons — usually a
   *  preview of what is about to change. */
  children?: React.ReactNode;
  /** Awaited by the dialog; the dialog stays open until it resolves. */
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  const [working, setWorking] = useState(false);

  async function handleConfirm() {
    if (working) return;
    setWorking(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={working ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={working}
          >
            {working ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}