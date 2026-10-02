"use client";

import { createContext, isValidElement, useContext } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, type EmptyStateAction } from "@/components/shared/empty-state";
import { ErrorMessage } from "@/components/shared/error-message";
import { cn } from "@/lib/utils";

/**
 * The one table every list surface in the app is built from.
 *
 * Before this existed, each screen hand-rolled its own wrapper div, its
 * own loading branch and its own empty block, which is why the same
 * "no results" copy appeared at four different heights. Here the
 * loading, error and empty branches are part of the component, so a
 * caller cannot forget one, and every list gets the same rhythm.
 *
 * Typical use:
 *
 *   <DataTable isLoading={isLoading} isError={isError} onRetry={refetch}
 *              isEmpty={rows.length === 0} empty={<EmptyState … />}
 *              hideAt={{ project: "lg" }}>
 *     <DataTableHeader>
 *       <DataTableRow>
 *         <DataTableHead>Payment</DataTableHead>
 *         <DataTableHead column="project">Project</DataTableHead>
 *         <DataTableHead numeric>Amount</DataTableHead>
 *       </DataTableRow>
 *     </DataTableHeader>
 *     <DataTableBody>
 *       <DataTableRow>…</DataTableRow>
 *     </DataTableBody>
 *   </DataTable>
 */

/** Column key -> the smallest breakpoint at which the column appears. */
export type HideAtMap = Record<string, "sm" | "md" | "lg" | "xl" | "2xl">;

/** Literal class strings so Tailwind's scanner can see them. */
const VISIBLE_FROM: Record<HideAtMap[string], string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

const DENSITY = {
  compact: "py-1",
  default: "py-1.5",
  comfortable: "py-3",
} as const;

export type DataTableDensity = keyof typeof DENSITY;

interface DataTableContextValue {
  hideAt: HideAtMap;
  density: DataTableDensity;
}

const DataTableContext = createContext<DataTableContextValue>({
  hideAt: {},
  density: "default",
});

function useDataTable() {
  return useContext(DataTableContext);
}

export interface DataTableProps {
  children: React.ReactNode;
  /**
   * Columns that collapse on narrow screens, e.g.
   * `{ project: "lg", employee: "xl" }` hides Project below `lg` and
   * Employee below `xl`. Keys must match the `column` prop on the
   * corresponding head and cell.
   */
  hideAt?: HideAtMap;
  density?: DataTableDensity;
  /** Fills the space the rows would occupy while data is in flight. */
  isLoading?: boolean;
  isError?: boolean;
  errorTitle?: string;
  errorMessage?: string;
  onRetry?: () => void;
  /** Usually `rows.length === 0`. Ignored while loading or errored. */
  isEmpty?: boolean;
  /** Rendered in place of the rows when empty. */
  empty?: React.ReactNode | { title: string; description?: string; icon?: React.ReactNode; action?: EmptyStateAction };
  /** Number of placeholder rows. */
  skeletonRows?: number;
  /** Column count, so the loading skeleton matches the real shape. */
  skeletonColumns?: number;
  className?: string;
  /** Escape hatch for the card, e.g. to drop the border on mobile. */
  containerClassName?: string;
}

export function DataTable({
  children,
  hideAt = {},
  density = "default",
  isLoading = false,
  isError = false,
  errorTitle = "Couldn't load this list",
  errorMessage = "Check your connection and try again.",
  onRetry,
  isEmpty = false,
  empty,
  skeletonRows = 6,
  skeletonColumns = 5,
  className,
  containerClassName,
}: DataTableProps) {
  // A fetch that is already on screen should keep the rows it has
  // rather than flashing a skeleton over them; callers pass isLoading
  // only for the first load.
  const showSkeleton = isLoading && !isError && !isEmpty;
  const showEmpty = isEmpty && !isLoading && !isError;

  return (
    <DataTableContext.Provider value={{ hideAt, density }}>
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card",
          containerClassName
        )}
      >
        {isError ? (
          <ErrorMessage
            title={errorTitle}
            message={errorMessage}
            onRetry={onRetry}
            className="py-10"
          />
        ) : showEmpty ? (
          <DataTableEmpty empty={empty} />
        ) : showSkeleton ? (
          <TableSkeleton rows={skeletonRows} columns={skeletonColumns} />
        ) : (
          <Table className={className}>{children}</Table>
        )}
      </div>
    </DataTableContext.Provider>
  );
}

function DataTableEmpty({ empty }: { empty: DataTableProps["empty"] }) {
  if (!empty) return null;
  // Callers can pass a full node, or just a title plus an action —
  // the short form is the common one.
  if (isValidElement(empty)) return empty;
  if (typeof empty === "object" && "title" in empty) return <EmptyState compact {...empty} />;
  return <>{empty}</>;
}

function TableSkeleton({ rows, columns }: { rows: number; columns: number }) {
  return (
    <div className="divide-y" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-3 py-2.5">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton
              key={c}
              // The first column stands in for the row's identity and
              // is always wider; the rest are uniform.
              className={cn("h-4", c === 0 ? "w-48" : "w-24")}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function DataTableHeader({
  className,
  ...props
}: React.ComponentProps<typeof TableHeader>) {
  return <TableHeader className={cn("bg-muted/40", className)} {...props} />;
}

export function DataTableBody({
  className,
  ...props
}: React.ComponentProps<typeof TableBody>) {
  return <TableBody className={className} {...props} />;
}

export function DataTableFooter({
  className,
  ...props
}: React.ComponentProps<typeof TableFooter>) {
  return <TableFooter className={className} {...props} />;
}

export interface DataTableRowProps
  extends React.ComponentProps<typeof TableRow> {
  /** Tints the row and marks it `aria-selected`; drives checkbox lists. */
  selected?: boolean;
  /** Makes the whole row a click target. */
  onClick?: React.ComponentProps<typeof TableRow>["onClick"];
}

export function DataTableRow({
  selected = false,
  className,
  onClick,
  ...props
}: DataTableRowProps) {
  const { density } = useDataTable();
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      onClick={onClick}
      className={cn(
        DENSITY[density],
        onClick && "cursor-pointer",
        className
      )}
      {...props}
    />
  );
}

/** Shared column behaviour: responsive collapse + numeric alignment. */
function useColumn(column: string | undefined, numeric: boolean | undefined) {
  const { hideAt } = useDataTable();
  return cn(
    column && hideAt[column] && VISIBLE_FROM[hideAt[column]],
    numeric && "text-right tabular-nums"
  );
}

export interface DataTableHeadProps
  extends React.ComponentProps<typeof TableHead> {
  /** Must match the key in DataTable's `hideAt` map. */
  column?: string;
  /** Right-aligns and enables tabular figures. */
  numeric?: boolean;
}

export function DataTableHead({
  column,
  numeric,
  className,
  ...props
}: DataTableHeadProps) {
  return (
    <TableHead
      className={cn(
        "text-xs text-muted-foreground first:pl-3 last:pr-3",
        useColumn(column, numeric),
        className
      )}
      {...props}
    />
  );
}

export interface DataTableCellProps
  extends React.ComponentProps<typeof TableCell> {
  column?: string;
  numeric?: boolean;
  /** Fills leftover width and truncates — for a row's primary field. */
  flex?: boolean;
}

export function DataTableCell({
  column,
  numeric,
  flex = false,
  className,
  ...props
}: DataTableCellProps) {
  return (
    <TableCell
      className={cn(
        "first:pl-3 last:pr-3",
        flex && "w-full min-w-0",
        useColumn(column, numeric),
        className
      )}
      {...props}
    />
  );
}

/**
 * The two-line primary cell used by most tables: a title with an
 * optional secondary line, both truncated, with the full text on the
 * `title` attribute so nothing is lost on hover.
 */
export function DataTableText({
  primary,
  secondary,
  primaryClassName,
  className,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode | null;
  primaryClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} title={typeof primary === "string" ? primary : undefined}>
      <p className={cn("truncate font-medium", primaryClassName)}>{primary}</p>
      {secondary ? (
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      ) : null}
    </div>
  );
}
