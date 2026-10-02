"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The search-and-filter row that sits above a list.
 *
 * Four fixed slots — search, filters, actions, chips — so every list in
 * the app lines its controls up on the same baseline and active filters
 * always appear in the same place. The filter slot collapses below `lg`;
 * the page is expected to offer a "Filters" button in the actions slot
 * instead, because four selects crushed onto a phone row are unusable.
 *
 *   <PageToolbar>
 *     <ToolbarSearch value={q} onChange={setQ} placeholder="Search…" />
 *     <ToolbarFilters>…selects…</ToolbarFilters>
 *     <ToolbarActions>…</ToolbarActions>
 *   </PageToolbar>
 *   <ToolbarChips onClearAll={clearFilters}>…FilterChip…</ToolbarChips>
 */
export function PageToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** Search input with a leading icon; the only control that stays visible at every width. */
export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-44 flex-1 sm:max-w-xs", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9"
      />
    </div>
  );
}

/** Desktop-only slot for filter selects. */
export function ToolbarFilters({ children }: { children: ReactNode }) {
  return <div className="hidden items-center gap-2 lg:flex">{children}</div>;
}

/** Right-aligned slot for page-level actions. */
export function ToolbarActions({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex items-center gap-2">{children}</div>;
}

/** Second row holding the active filters as removable pills. */
export function ToolbarChips({
  onClearAll,
  clearLabel = "Clear all",
  children,
}: {
  onClearAll: () => void;
  clearLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {clearLabel}
      </button>
    </div>
  );
}

/** One removable active filter. */
export function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
    >
      {label}
      <X className="size-3 text-muted-foreground" aria-hidden />
      <span className="sr-only">Remove filter</span>
    </button>
  );
}
