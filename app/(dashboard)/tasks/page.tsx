"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  List,
  KanbanSquare,
  CalendarDays,
  Table2,
  Search,
  SlidersHorizontal,
  Bookmark,
  Plus,
  Check,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskCard } from "@/components/tasks/task-card";
import { BoardView } from "@/components/tasks/board-view";
import { CalendarView } from "@/components/tasks/calendar-view";
import { TableView } from "@/components/tasks/table-view";
import { QuickAddTask } from "@/components/tasks/quick-add-task";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { deleteSavedFilter, type SavedFilterRow } from "@/lib/actions/task-extras";
import { TASK_STATUSES, TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants";
import {
  taskListOptions,
  activeEmployeesOptions,
  labelsOptions,
  savedFiltersOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { useSession } from "@/components/providers/session-provider";
import { cn } from "@/lib/utils";
import type { TaskView } from "@/types/database";

interface Filters {
  status: string;
  priority: string;
  assigned_to: string;
  label_id: string;
}

const EMPTY_FILTERS: Filters = { status: "", priority: "", assigned_to: "", label_id: "" };

const VIEW_TABS: Array<{ key: TaskView; label: string; icon: typeof List }> = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: KanbanSquare },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "table", label: "Table", icon: Table2 },
];

/** Built-in views that behave like saved filters (§25) */
const BUILT_IN_VIEWS: Array<{ name: string; filters: Partial<Filters> }> = [
  { name: "All tasks", filters: {} },
  { name: "My tasks", filters: { assigned_to: "ME" } },
  { name: "Due today", filters: { status: "DUE_TODAY" } },
  { name: "Overdue", filters: { status: "OVERDUE" } },
  { name: "Needs review", filters: { status: "SUBMITTED" } },
  { name: "High priority", filters: { priority: "HIGH" } },
];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { userId: currentUserId, role: userRole } = useSession();

  // Cached queries — revisiting this page reads from cache, it does not
  // refetch while data is fresh (§3). Realtime keeps it live (§5).
  const tasksQuery = useQuery(taskListOptions);
  const employeesQuery = useQuery(activeEmployeesOptions);
  const labelsQuery = useQuery(labelsOptions);
  const savedViewsQuery = useQuery(savedFiltersOptions);

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const employees = employeesQuery.data ?? [];
  const labels = labelsQuery.data ?? [];
  const savedViews = savedViewsQuery.data ?? [];
  const loading = tasksQuery.isLoading;

  const [view, setView] = useState<TaskView>("list");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // Snapshot "now" once per task-load so filtering stays pure per render
  const [nowStamp, setNowStamp] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setNowStamp(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, [tasks.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = nowStamp;
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const todayStart = new Date(todayEnd.getTime() - 24 * 60 * 60 * 1000);

    return tasks.filter((t) => {
      if (filters.status === "OVERDUE") {
        if (!t.deadline || new Date(t.deadline).getTime() >= now || t.status === "COMPLETED")
          return false;
      } else if (filters.status === "DUE_TODAY") {
        if (
          !t.deadline ||
          new Date(t.deadline).getTime() < todayStart.getTime() ||
          new Date(t.deadline).getTime() > todayEnd.getTime()
        )
          return false;
      } else if (filters.status && t.status !== filters.status) {
        return false;
      }
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.assigned_to === "ME" && t.assigned_to !== currentUserId) return false;
      if (
        filters.assigned_to &&
        filters.assigned_to !== "ME" &&
        t.assigned_to !== filters.assigned_to
      )
        return false;
      if (filters.label_id && !t.labels.some((l) => l.id === filters.label_id)) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, search, filters, currentUserId, nowStamp]);

  const activeView = BUILT_IN_VIEWS.find(
    (v) =>
      Object.entries(v.filters).every(
        ([k, val]) => filters[k as keyof Filters] === val
      ) && Object.keys(v.filters).length > 0
  );

  const activeFilterCount =
    (filters.status ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.assigned_to ? 1 : 0) +
    (filters.label_id ? 1 : 0);

  async function handleSaveView() {
    const name = window.prompt("Name this view:");
    if (!name?.trim()) return;
    const { saveFilter } = await import("@/lib/actions/task-extras");
    const result = await saveFilter(name.trim(), {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.assigned_to ? { assigned_to: filters.assigned_to } : {}),
      ...(filters.label_id ? { label_id: filters.label_id } : {}),
    });
    if (result.success && result.data) {
      queryClient.setQueryData<SavedFilterRow[]>(qk.savedFilters(), (prev) => [
        ...(prev ?? []),
        result.data!,
      ]);
      toast.success("View saved");
    } else {
      toast.error(result.error ?? "Couldn't save view");
    }
  }

  async function handleDeleteView(id: string) {
    const result = await deleteSavedFilter(id);
    if (result.success) {
      queryClient.setQueryData<SavedFilterRow[]>(qk.savedFilters(), (prev) =>
        (prev ?? []).filter((v) => v.id !== id)
      );
    } else {
      toast.error(result.error ?? "Couldn't delete view");
    }
  }

  const filterBody = (
    <div className="space-y-5">
      <FilterGroup label="Status">
        <FilterChip label="Any" active={!filters.status} onClick={() => setFilters((f) => ({ ...f, status: "" }))} />
        <FilterChip label="Due today" active={filters.status === "DUE_TODAY"} onClick={() => setFilters((f) => ({ ...f, status: f.status === "DUE_TODAY" ? "" : "DUE_TODAY" }))} />
        <FilterChip label="Overdue" active={filters.status === "OVERDUE"} onClick={() => setFilters((f) => ({ ...f, status: f.status === "OVERDUE" ? "" : "OVERDUE" }))} />
        {TASK_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={TASK_STATUS_LABELS[s]}
            active={filters.status === s}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === s ? "" : s }))}
          />
        ))}
      </FilterGroup>
      <FilterGroup label="Priority">
        <FilterChip label="Any" active={!filters.priority} onClick={() => setFilters((f) => ({ ...f, priority: "" }))} />
        {(["HIGH", "URGENT", "MEDIUM", "LOW"] as const).map((p) => (
          <FilterChip
            key={p}
            label={PRIORITY_LABELS[p]}
            active={filters.priority === p}
            onClick={() => setFilters((f) => ({ ...f, priority: f.priority === p ? "" : p }))}
          />
        ))}
      </FilterGroup>
      <FilterGroup label="Assignee">
        <FilterChip label="Everyone" active={!filters.assigned_to} onClick={() => setFilters((f) => ({ ...f, assigned_to: "" }))} />
        <FilterChip label="Me" active={filters.assigned_to === "ME"} onClick={() => setFilters((f) => ({ ...f, assigned_to: f.assigned_to === "ME" ? "" : "ME" }))} />
        {employees.map((e) => (
          <FilterChip
            key={e.id}
            label={e.full_name}
            active={filters.assigned_to === e.id}
            onClick={() =>
              setFilters((f) => ({ ...f, assigned_to: f.assigned_to === e.id ? "" : e.id }))
            }
          />
        ))}
      </FilterGroup>
      {labels.length > 0 && (
        <FilterGroup label="Label">
          <FilterChip label="Any" active={!filters.label_id} onClick={() => setFilters((f) => ({ ...f, label_id: "" }))} />
          {labels.map((l) => (
            <FilterChip
              key={l.id}
              label={l.name}
              active={filters.label_id === l.id}
              onClick={() =>
                setFilters((f) => ({ ...f, label_id: f.label_id === l.id ? "" : l.id }))
              }
            />
          ))}
        </FilterGroup>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Tasks</h1>
        <Link href="/tasks/new">
          <Button size="sm">
            <Plus className="size-4" /> New task
          </Button>
        </Link>
      </div>

      {/* Search + view switcher + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="pl-9"
          />
        </div>

        {/* View switcher (§6-§9) */}
        <div className="flex items-center rounded-lg border p-0.5">
          {VIEW_TABS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-label={v.label}
              aria-pressed={view === v.key}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
                view === v.key
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <v.icon className="size-3.5" />
              <span className="hidden md:inline">{v.label}</span>
            </button>
          ))}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          >
            <Bookmark className="size-3.5" />
            <span className="hidden sm:inline">Views</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {BUILT_IN_VIEWS.map((v) => (
              <DropdownMenuItem
                key={v.name}
                onClick={() =>
                  setFilters({
                    status: v.filters.status ?? "",
                    priority: v.filters.priority ?? "",
                    assigned_to: v.filters.assigned_to ?? "",
                    label_id: v.filters.label_id ?? "",
                  })
                }
              >
                <Check
                  className={cn("mr-1 size-3.5", activeView?.name === v.name ? "opacity-100" : "opacity-0")}
                />
                {v.name}
              </DropdownMenuItem>
            ))}
            {savedViews.length > 0 && <div className="my-1 h-px bg-border" />}
            {savedViews.map((v) => (
              <DropdownMenuItem key={v.id} onClick={() => setFilters({ status: v.filters.status ?? "", priority: v.filters.priority ?? "", assigned_to: v.filters.assigned_to ?? "", label_id: v.filters.label_id ?? "" })}>
                <Check className="mr-1 size-3.5 opacity-0" />
                <span className="flex-1">{v.name}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteView(v.id);
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete view ${v.name}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <div className="my-1 h-px bg-border" />
            <DropdownMenuItem onClick={handleSaveView}>
              <Plus className="mr-1 size-3.5" /> Save current view
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilterOpen(true)}
          className="gap-1.5"
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Quick add (list view only) */}
      {view === "list" && userRole === "ADMIN" && !loading && (
        <QuickAddTask
          onCreated={() => {
            // Targeted: the created task lands via one list refetch.
            void queryClient.invalidateQueries({ queryKey: qk.tasks() });
          }}
        />
      )}

      {/* Content */}
      {loading ? (
        <SkeletonList rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={tasks.length === 0 ? "No tasks yet" : "No tasks match your filters"}
          description={
            tasks.length === 0
              ? "Create your first task to start assigning work."
              : "Try adjusting the search or filters."
          }
          action={tasks.length === 0 ? { label: "New task", href: "/tasks/new" } : undefined}
        />
      ) : view === "board" ? (
        <BoardView
          tasks={filtered}
          currentUserId={currentUserId}
          isAdmin={userRole === "ADMIN"}
        />
      ) : view === "calendar" ? (
        <CalendarView tasks={filtered} />
      ) : view === "table" ? (
        <TableView tasks={filtered} />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((t) => (
            <TaskCard
              key={t.id}
              href={`/tasks/${t.id}`}
              title={t.title}
              projectName={t.project_name}
              status={t.status}
              priority={t.priority}
              deadline={t.deadline}
              payoutAmount={t.payout_amount}
              paymentStatus={t.payment_status}
              assignedName={t.assigned_name}
              labels={t.labels}
              subtasksDone={t.subtasks_done}
              subtasksTotal={t.subtasks_total}
              commentsCount={t.comments_count}
              attachmentsCount={t.attachments_count}
            />
          ))}
        </div>
      )}

      {/* Mobile filter sheet (§31) */}
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div
            className="max-h-[60vh] overflow-y-auto px-4"
            style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
          >
            {filterBody}
            <Button className="mt-6 w-full" onClick={() => setFilterOpen(false)}>
              Show {filtered.length} task{filtered.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}
