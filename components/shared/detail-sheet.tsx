"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Read-only detail panel for a single record.
 *
 * A record's full shape is too wide for a table row and too important
 * for a tooltip, so it opens in a side panel instead of navigating
 * away. The layout is fixed — title block, scrollable body, optional
 * footer — so every detail panel in the app opens the same way and
 * muscle memory carries over.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: "right" | "left";
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={cn("gap-0 p-0", className)}>
        <SheetHeader className="shrink-0 border-b pb-4">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            // Sheet requires a description for its accessible name to
            // be complete; hide it visually when there is nothing to
            // say rather than leaving a gap.
            <SheetDescription className="sr-only">
              Details for this record
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>
        {footer ? (
          <SheetFooter className="shrink-0 border-t bg-muted/40">{footer}</SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Label/value row for the body of a DetailSheet.
 *
 * `mono` is for identifiers and currency so digits line up down the
 * column; `danger` is for the one value that needs attention.
 */
export function DetailRow({
  label,
  children,
  mono = false,
  danger = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-sm",
          mono && "tabular-nums",
          danger && "text-destructive"
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** Groups DetailRows into a labelled block. */
export function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <dl className="divide-y">{children}</dl>
    </section>
  );
}
