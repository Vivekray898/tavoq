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
  AlertTriangle,
  ArrowUpDown,
  Clock,
  Eye,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskCard } from "@/components/tasks/task-card";
import { BoardView } from "@/components/tasks/board-view";
import { CalendarView } from "@/components/tasks/calendar-view";
import { TableView } from "@/components/tasks/table-view";
import { QuickAddTask } from "@/components/tasks/quick-add-task";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { bulkUpdateTasks } from "@/lib/actions/tasks";
import { deleteSavedFilter, type SavedFilterRow } from "@/lib/actions/task-extras";
import { TASK_STATUSES, TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants";
import {
  taskListOptions,
  activeEmployeesOptions,
  labelsOptions,
  savedFiltersOptions,
  projectsForTaskOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { useSession } from "@/components/providers/session-provider";
import { cn, isOverdue, isDueToday } from "@/lib/utils";
import type { TaskStatus, TaskPriority, TaskView } from "@/types/database";

interface Filters {
  status: string;
  priority: string;
  assigned_to: string;
  label_id: string;
  project_id: string;
  client_id: string;
}

const EMPTY_FILTERS: Filters = {
  status: "",
  priority: "",
  assigned_to: "",
  label_id: "",
  project_id: "",
  client_id: "",
};

type SortKey = "due" | "priority" | "created" | "updated" | "name";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  due: "Due date",
  priority: "Priority",
  created: "Created date",
  updated: "Updated date",
  name: "Task name",
};

const PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

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

const FILTERS_STORAGE_KEY = "taskora.task-filters";

function loadStoredFilters(): Filters {
  try {
    const raw = window.sessionStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return EMPTY_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return { ...EMPTY_FILTERS, ...parsed };
  } catch {
    return EMPTY_FILTERS;
  }
}

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { userId: currentUserId, role: userRole } = useSession();
  const isAdmin = userRole === "ADMIN";

  // Cached queries — revisiting this page reads from cache, it does not
  // refetch while data is fresh (§3). Realtime keeps it live (§5).
  const tasksQuery = useQuery(taskListOptions);
  const employeesQuery = useQuery(activeEmployeesOptions);
  const labelsQuery = useQuery(labelsOptions);
  const savedViewsQuery = useQuery(savedFiltersOptions);
  const projectsQuery = useQuery(projectsForTaskOptions);

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const employees = employeesQuery.data ?? [];
  const labels = labelsQuery.data ?? [];
  const savedViews = savedViewsQuery.data ?? [];
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const loading = tasksQuery.isLoading;

  const [view, setView] = useState<TaskView>("list");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // §25 — remember filters while navigating (session-scoped, not forever).
  // Hydrated in a microtask to avoid setState-in-effect and SSR mismatch.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setFilters(loadStoredFilters());
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // storage unavailable — filters just won't persist
    }
  }, [filters]);

  // §4 — client-side sorting over already-loaded data
  const [sortKey, setSortKey] = useState<SortKey | "">("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // §7 — bulk selection (admins only)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<"assigned_to" | "status" | "priority" | "project_id">("status");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);

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
      // §3 — project + client filters, resolved from cached data
      if (filters.project_id && t.project_id !== filters.project_id) return false;
      if (filters.client_id) {
        const project = projects.find((p) => p.id === t.project_id);
        // client names come embedded on the projects-for-task rows
        if (!project || project.client_name.toLowerCase() !== clientNameFor(filters.client_id)) {
          // fall back to task list's own client_name when present
          if (t.client_name !== clientNameFor(filters.client_id)) return false;
        }
      }
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, search, filters, currentUserId, nowStamp, projects]);

  // Resolve client name from the activeClients-equivalent cached rows.
  // projectsForTask rows carry client_name; client filter chips store ids.
  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      if (p.client_name && !map.has(p.client_name)) {
        // no client id on this query — key by name instead (see below)
        map.set(p.client_name, p.client_name);
      }
    }
    return Array.from(map.keys()).sort();
  }, [projects]);

  function clientNameFor(id: string) {
    return id; // client_id filter stores the display name (see FilterGroup below)
  }

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortKey) {
        case "due": {
          const ad = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
          const bd = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
          return (ad - bd) * dir;
        }
        case "priority":
          return ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)) * dir;
        case "created":
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        case "updated":
          return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * dir;
        case "name":
          return a.title.localeCompare(b.title) * dir;
        default:
          return 0;
      }
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

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
    (filters.label_id ? 1 : 0) +
    (filters.project_id ? 1 : 0) +
    (filters.client_id ? 1 : 0);

  // ── §14 — My Tasks summary (employees) — computed from cached data ──
  const summary = useMemo(() => {
    const mine = currentUserId ? tasks.filter((t) => t.assigned_to === currentUserId) : tasks;
    const notDone = mine.filter((t) => t.status !== "COMPLETED");
    return {
      total: mine.length,
      inProgress: notDone.filter((t) => t.status === "IN_PROGRESS").length,
      dueToday: notDone.filter((t) => isDueToday(t.deadline)).length,
      overdue: notDone.filter((t) => isOverdue(t.deadline)).length,
      awaitingReview: mine.filter((t) => t.status === "SUBMITTED").length,
    };
  }, [tasks, currentUserId]);

  // ── §5 — Needs Attention strip (employee-relevant) ──
  const needsAttention = useMemo(() => {
    const scoped = isAdmin
      ? tasks
      : tasks.filter((t) => t.assigned_to === currentUserId);
    const notDone = scoped.filter((t) => t.status !== "COMPLETED");
    const overdue = notDone.filter((t) => isOverdue(t.deadline));
    const dueToday = notDone.filter((t) => isDueToday(t.deadline) && !isOverdue(t.deadline));
    const submitted = scoped.filter((t) => t.status === "SUBMITTED");
    const revision = scoped.filter((t) => t.status === "REVISION_REQUIRED");
    const items: Array<{ count: number; label: string; href: string; tone: string; icon: typeof Clock }> = [];
    if (overdue.length)
      items.push({ count: overdue.length, label: "overdue", href: "/tasks?status=OVERDUE", tone: "text-destructive", icon: AlertTriangle });
    if (dueToday.length)
      items.push({ count: dueToday.length, label: "due today", href: "/tasks?status=DUE_TODAY", tone: "text-amber-600 dark:text-amber-400", icon: Clock });
    if (submitted.length && isAdmin)
      items.push({ count: submitted.length, label: "awaiting review", href: "/tasks?status=SUBMITTED", tone: "text-violet-600 dark:text-violet-400", icon: Eye });
    if (revision.length)
      items.push({ count: revision.length, label: "needs revision", href: "/tasks?status=REVISION_REQUIRED", tone: "text-orange-600 dark:text-orange-400", icon: AlertTriangle });
    return items;
  }, [tasks, currentUserId, isAdmin]);

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

  // ── §7 — bulk actions ──
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function runBulk() {
    if (selected.size === 0 || !bulkValue) return;
    setBulkWorking(true);
    const changes: Parameters<typeof bulkUpdateTasks>[1] =
      bulkField === "assigned_to"
        ? { assigned_to: bulkValue || null }
        : bulkField === "status"
          ? { status: bulkValue as TaskStatus }
          : bulkField === "priority"
            ? { priority: bulkValue as TaskPriority }
            : { project_id: bulkValue };
    const result = await bulkUpdateTasks(Array.from(selected), changes);
    setBulkWorking(false);
    if (result.success) {
      toast.success(
        `Updated ${result.data?.updated ?? selected.size} task${selected.size !== 1 ? "s" : ""}`
      );
      setBulkOpen(false);
      setBulkValue("");
      clearSelection();
      // The changed rows also live in any cached detail entries.
      void queryClient.invalidateQueries({ queryKey: qk.tasks(), refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't update the selected tasks");
    }
  }

  const bulkFields: Array<{ value: typeof bulkField; label: string }> = [
    { value: "assigned_to", label: "Assign employee" },
    { value: "status", label: "Change status" },
    { value: "priority", label: "Change priority" },
    ...(isAdmin ? [{ value: "project_id" as const, label: "Move project" }] : []),
  ];

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
        {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((p) => (
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
      <FilterGroup label="Project">
        <FilterChip label="Any" active={!filters.project_id} onClick={() => setFilters((f) => ({ ...f, project_id: "" }))} />
        {projects.map((p) => (
          <FilterChip
            key={p.id}
            label={p.name}
            active={filters.project_id === p.id}
            onClick={() =>
              setFilters((f) => ({ ...f, project_id: f.project_id === p.id ? "" : p.id }))
            }
          />
        ))}
      </FilterGroup>
      <FilterGroup label="Client">
        <FilterChip label="Any" active={!filters.client_id} onClick={() => setFilters((f) => ({ ...f, client_id: "" }))} />
        {clientOptions.map((name) => (
          <FilterChip
            key={name}
            label={name}
            active={filters.client_id === name}
            onClick={() =>
              setFilters((f) => ({ ...f, client_id: f.client_id === name ? "" : name }))
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

      {/* §5 — Needs Attention */}
      {needsAttention.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {needsAttention.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent/50",
                item.tone
              )}
            >
              <item.icon className="size-3.5" />
              <span className="tabular-nums">{item.count}</span> {item.label}
            </Link>
          ))}
        </div>
      )}

      {/* §14 — summary (employees see their own; admins see the workspace) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {[
          { label: "Total", value: summary.total },
          { label: "In progress", value: summary.inProgress },
          { label: "Due today", value: summary.dueToday },
          { label: "Overdue", value: summary.overdue, tone: summary.overdue > 0 ? "text-destructive" : undefined },
          { label: "Awaiting review", value: summary.awaitingReview },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border bg-card px-3 py-2.5 text-center">
            <p className={cn("text-lg font-semibold tabular-nums", s.tone)}>{s.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search + view switcher + filters + sort */}
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

        {/* §4 — sorting */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          >
            <ArrowUpDown className="size-3.5" />
            <span className="hidden sm:inline">
              {sortKey ? `${SORT_LABELS[sortKey]}` : "Sort"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => {
                  if (sortKey === key) {
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  } else {
                    setSortKey(key);
                    setSortDir(key === "name" ? "asc" : "desc");
                  }
                }}
              >
                <Check
                  className={cn("mr-1 size-3.5", sortKey === key ? "opacity-100" : "opacity-0")}
                />
                {SORT_LABELS[key]}
                {sortKey === key && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            {sortKey && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSortKey("")}>
                  <X className="mr-1 size-3.5" /> No sorting
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

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
                    project_id: v.filters.project_id ?? "",
                    client_id: v.filters.client_id ?? "",
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
              <DropdownMenuItem key={v.id} onClick={() => setFilters({ ...EMPTY_FILTERS, status: v.filters.status ?? "", priority: v.filters.priority ?? "", assigned_to: v.filters.assigned_to ?? "", label_id: v.filters.label_id ?? "" })}>
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

      {/* Bulk action bar (§7) */}
      {isAdmin && selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            Apply action
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {/* Quick add (list view only) */}
      {view === "list" && isAdmin && !loading && (
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
      ) : sorted.length === 0 ? (
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
          tasks={sorted}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      ) : view === "calendar" ? (
        <CalendarView tasks={sorted} />
      ) : view === "table" ? (
        <TableView tasks={sorted} />
      ) : (
        <div className="space-y-2.5">
          {sorted.map((t) =>
            isAdmin ? (
              <div key={t.id} className="flex items-start gap-2">
                <Checkbox
                  checked={selected.has(t.id)}
                  onCheckedChange={() => toggleSelect(t.id)}
                  aria-label={`Select ${t.title}`}
                  className="mt-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <TaskCard
                    href={`/tasks/${t.id}`}
                    title={t.title}
                    projectName={t.project_name}
                    status={t.status}
                    priority={t.priority}
                    deadline={t.deadline}
                    assignedName={t.assigned_name}
                    labels={t.labels}
                    subtasksDone={t.subtasks_done}
                    subtasksTotal={t.subtasks_total}
                    commentsCount={t.comments_count}
                    attachmentsCount={t.attachments_count}
                    updatedAt={t.updated_at}
                  />
                </div>
              </div>
            ) : (
              <TaskCard
                key={t.id}
                href={`/tasks/${t.id}`}
                title={t.title}
                projectName={t.project_name}
                status={t.status}
                priority={t.priority}
                deadline={t.deadline}
                assignedName={t.assigned_name}
                labels={t.labels}
                subtasksDone={t.subtasks_done}
                subtasksTotal={t.subtasks_total}
                commentsCount={t.comments_count}
                attachmentsCount={t.attachments_count}
                updatedAt={t.updated_at}
              />
            )
          )}
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
              Show {sorted.length} task{sorted.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Bulk change dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Update {selected.size} task{selected.size !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              The change applies to every selected task at once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Action</label>
                <Select
                  items={Object.fromEntries(bulkFields.map((f) => [f.value, f.label]))}
                  value={bulkField}
                  onValueChange={(v) => {
                    setBulkField((v ?? "status") as typeof bulkField);
                    setBulkValue("");
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bulkFields.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Value</label>
                {bulkField === "assigned_to" ? (
                  <Select
                    items={Object.fromEntries([
                      ["", "Unassign"],
                      ...employees.map((e) => [e.id, e.full_name] as const),
                    ])}
                    value={bulkValue || undefined}
                    onValueChange={(v) => setBulkValue(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Unassign</SelectItem>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : bulkField === "status" ? (
                  <Select
                    items={Object.fromEntries(
                      (["TODO", "IN_PROGRESS", "COMPLETED"] as const).map((s) => [
                        s,
                        TASK_STATUS_LABELS[s],
                      ])
                    )}
                    value={bulkValue || undefined}
                    onValueChange={(v) => setBulkValue(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(["TODO", "IN_PROGRESS", "COMPLETED"] as const).map((s) => (
                        <SelectItem key={s} value={s}>
                          {TASK_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : bulkField === "priority" ? (
                  <Select
                    items={Object.fromEntries(
                      (["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const).map((p) => [
                        p,
                        PRIORITY_LABELS[p],
                      ])
                    )}
                    value={bulkValue || undefined}
                    onValueChange={(v) => setBulkValue(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const).map((p) => (
                        <SelectItem key={p} value={p}>
                          {PRIORITY_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    items={Object.fromEntries(
                      projects.map((p) => [
                        p.id,
                        p.client_name ? `${p.client_name} — ${p.name}` : p.name,
                      ])
                    )}
                    value={bulkValue || undefined}
                    onValueChange={(v) => setBulkValue(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.client_name ? `${p.client_name} — ${p.name}` : p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkWorking}>
              Cancel
            </Button>
            <Button onClick={runBulk} disabled={bulkWorking || !bulkValue}>
              {bulkWorking && <Loader2 className="size-4 animate-spin" />}
              Apply to {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
