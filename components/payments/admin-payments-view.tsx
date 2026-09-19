"use client";

/**
 * Admin Payout Management workspace.
 *
 * Information architecture:
 *   Header          — title + primary "Create payment" CTA
 *   Metrics strip   — compact ERP-style financial metrics (amount + count)
 *   Workspace tabs  — All / Pending / Paid / Employees, driven from cache
 *   Toolbar         — cached-first search, employee/type/date filters, sort
 *   Payments table  — desktop table; compact record cards on mobile
 *   Employees tab   — payout overview per employee → payout detail sheet
 *   Sheets/Dialogs  — create payment, payment detail, bulk mark-paid
 *
 * All data comes from the existing paymentWorkspaceOptions cache that the
 * realtime provider keeps fresh; every mutation patches the cache in place.
 * No polling, no router.refresh, no duplicate subscriptions.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Banknote,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  Ellipsis,
  Eye,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import {
  createCustomPayment,
  createPaymentFromTasks,
  markPaymentPaid,
  markPaymentsPaidBatch,
  updatePaymentNote,
  type PaymentItem,
  type PaymentWorkspaceData,
} from "@/lib/actions/payments";
import {
  paymentWorkspaceOptions,
  payableTasksOptions,
  activeEmployeesOptions,
  employeeDetailOptions,
} from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { cn, formatCurrency, formatDate, getInitials } from "@/lib/utils";
import { TASK_STATUS_DOTS, TASK_STATUS_LABELS } from "@/lib/constants";
import type { TaskStatus } from "@/types/database";

// ──────────────────────────────────────────────
// Types & small building blocks
// ──────────────────────────────────────────────

type StatusFilter = "ALL" | "PENDING" | "PAID";
type TypeFilter = "ALL" | "TASK" | "CUSTOM";
type DateFilter = "ALL" | "WEEK" | "MONTH" | "QUARTER";
type SortKey = "NEWEST" | "OLDEST" | "AMOUNT_DESC" | "AMOUNT_ASC";
type WorkspaceTab = "payments" | "pending" | "paid" | "employees";

/** Subtle semantic status badge — dot/text, not a giant pill. */
function PaymentStatusBadge({ status }: { status: PaymentItem["status"] }) {
  const paid = status === "PAID";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 border",
        paid
          ? "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-transparent bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      )}
    >
      {paid ? <Check className="size-3" /> : <Circle className="size-2.5 fill-current" />}
      {paid ? "Paid" : "Pending"}
    </Badge>
  );
}

/** Task payout vs custom payment — always explicit. */
function PaymentKindBadge({ kind }: { kind: PaymentItem["kind"] }) {
  return kind === "TASK" ? (
    <Badge variant="outline" className="gap-1 font-medium">
      <Banknote className="size-3" /> Task payout
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 font-medium text-muted-foreground">
      <Sparkles className="size-3" /> Custom
    </Badge>
  );
}

function EmployeeCell({
  name,
  avatarUrl,
}: {
  name: string | null;
  avatarUrl?: string | null;
}) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar size="sm">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-full rounded-full object-cover" />
        ) : null}
        <AvatarFallback className="text-[9px]">{getInitials(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm">{name}</span>
    </span>
  );
}

/** Compact ERP metric: amount + sub-count, separated by rules, not cards. */
function Metric({
  label,
  amount,
  sub,
  tone,
}: {
  label: string;
  amount: number;
  sub: string;
  tone?: "pending" | "default";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-xl font-semibold tabular-nums tracking-tight lg:text-2xl",
          tone === "pending" && amount > 0 && "text-amber-600 dark:text-amber-400"
        )}
      >
        {formatCurrency(amount)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** Row date: paid date when settled, created date while pending. */
function rowDate(p: PaymentItem): { date: string | null; label: string } {
  return p.status === "PAID" && p.paid_at
    ? { date: p.paid_at, label: "Paid" }
    : { date: p.created_at ?? null, label: "Created" };
}

function withinDateFilter(dateIso: string | null, filter: DateFilter): boolean {
  if (filter === "ALL" || !dateIso) return filter === "ALL" ? true : false;
  const t = new Date(dateIso).getTime();
  if (isNaN(t)) return false;
  const now = new Date();
  if (filter === "WEEK") return t >= now.getTime() - 7 * 86_400_000;
  if (filter === "MONTH") {
    return (
      t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    );
  }
  // QUARTER — calendar quarter start
  const qMonth = Math.floor(now.getMonth() / 3) * 3;
  return t >= new Date(now.getFullYear(), qMonth, 1).getTime();
}

const TASK_STATUS_ORDER: TaskStatus[] = [
  "COMPLETED",
  "SUBMITTED",
  "IN_PROGRESS",
  "REVISION_REQUIRED",
  "TODO",
];

// ──────────────────────────────────────────────
// The workspace
// ──────────────────────────────────────────────

export function AdminPaymentsView() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading, isError, refetch } = useQuery(paymentWorkspaceOptions);

  // ── Workspace state (all client-side; the cache is the source of truth) ──
  const [tab, setTab] = useState<WorkspaceTab>("payments");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [employeeFilter, setEmployeeFilter] = useState<string>("ALL");
  const [dateFilter, setDateFilter] = useState<DateFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("NEWEST");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Bulk selection over pending rows ──
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);

  // ── Create-payment sheet ──
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmployeeId, setCreateEmployeeId] = useState("");
  const [createType, setCreateType] = useState<"TASK" | "CUSTOM">("TASK");
  const [createSearch, setCreateSearch] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<Map<string, number>>(new Map());
  const [unpaidOnly, setUnpaidOnly] = useState(true);
  const [taskSearch, setTaskSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paymentNote, setPaymentNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customMarkPaid, setCustomMarkPaid] = useState(false);
  const [customSaving, setCustomSaving] = useState(false);

  // ── Payment detail sheet + note editing ──
  const [detailId, setDetailId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // ── Employees tab detail sheet ──
  const [employeeSheetId, setEmployeeSheetId] = useState<string | null>(null);
  const employeeDetailQuery = useQuery({
    ...employeeDetailOptions(employeeSheetId ?? ""),
    enabled: !!employeeSheetId,
  });

  // ────────────────────────────────────────────
  // Derived data — everything below is computed
  // from the cached workspace (zero network).
  // ────────────────────────────────────────────

  const employeesQuery = useQuery(activeEmployeesOptions);
  const avatarById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const e of employeesQuery.data ?? []) m.set(e.id, e.avatar_url);
    return m;
  }, [employeesQuery.data]);

  const history = useMemo(() => data?.history ?? [], [data?.history]);
  const summary = data?.summary;
  const employeeRows = useMemo(() => data?.employees ?? [], [data?.employees]);

  const counts = useMemo(
    () => ({
      all: history.length,
      pending: history.filter((p) => p.status === "PENDING").length,
      paid: history.filter((p) => p.status === "PAID").length,
    }),
    [history]
  );

  const tabStatus: StatusFilter =
    tab === "pending" ? "PENDING" : tab === "paid" ? "PAID" : "ALL";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = history.filter((p) => {
      if (tabStatus !== "ALL" && p.status !== tabStatus) return false;
      if (typeFilter !== "ALL" && p.kind !== typeFilter) return false;
      if (employeeFilter !== "ALL" && p.employee_id !== employeeFilter) return false;
      if (!withinDateFilter(rowDate(p).date, dateFilter)) return false;
      if (q) {
        const hay = `${p.label} ${p.employee_name ?? ""} ${p.project_name ?? ""} ${
          p.client_name ?? ""
        } ${p.payment_note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortKey === "AMOUNT_DESC") return b.amount - a.amount;
      if (sortKey === "AMOUNT_ASC") return a.amount - b.amount;
      const da = new Date(rowDate(a).date ?? 0).getTime();
      const db = new Date(rowDate(b).date ?? 0).getTime();
      return sortKey === "OLDEST" ? da - db : db - da;
    });
    return rows;
  }, [history, tabStatus, typeFilter, employeeFilter, dateFilter, search, sortKey]);

  const filtersActive =
    typeFilter !== "ALL" || employeeFilter !== "ALL" || dateFilter !== "ALL" || search.trim() !== "";

  function clearFilters() {
    setTypeFilter("ALL");
    setEmployeeFilter("ALL");
    setDateFilter("ALL");
    setSearch("");
  }

  const bulkTotal = useMemo(
    () => history.filter((p) => bulkIds.has(p.id)).reduce((s, p) => s + p.amount, 0),
    [history, bulkIds]
  );

  const detail = detailId ? (history.find((p) => p.id === detailId) ?? null) : null;
  const detailEmployeeSheet = employeeSheetId
    ? (employeeRows.find((e) => e.id === employeeSheetId) ?? null)
    : null;
  const employeeHistory = useMemo(
    () => history.filter((p) => p.employee_id === employeeSheetId),
    [history, employeeSheetId]
  );

  // ────────────────────────────────────────────
  // Cache mutations — patch in place (no refetch)
  // ────────────────────────────────────────────

  function patchHistoryRow(id: string, patch: Partial<PaymentItem>) {
    queryClient.setQueryData<PaymentWorkspaceData>(qk.paymentWorkspace(), (prev) =>
      prev
        ? {
            ...prev,
            history: prev.history.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          }
        : prev
    );
  }

  async function handleMarkPaid(payment: PaymentItem) {
    const result = await markPaymentPaid(payment.id);
    if (result.success && result.data) {
      patchHistoryRow(payment.id, { status: "PAID", paid_at: result.data.paid_at });
      toast.success(`Marked paid — ${formatCurrency(result.data.amount)}`);
      setBulkIds((prev) => {
        const next = new Set(prev);
        next.delete(payment.id);
        return next;
      });
      if (detailId === payment.id) setDetailId(null);
    } else {
      toast.error(result.error ?? "Couldn't mark the payment as paid");
    }
  }

  async function runBulkMarkPaid() {
    if (bulkIds.size === 0) return;
    setBulkWorking(true);
    const result = await markPaymentsPaidBatch(Array.from(bulkIds));
    setBulkWorking(false);
    if (result.success && result.data) {
      const paidAtById = new Map(result.data.items.map((i) => [i.id, i.paid_at]));
      queryClient.setQueryData<PaymentWorkspaceData>(qk.paymentWorkspace(), (prev) =>
        prev
          ? {
              ...prev,
              history: prev.history.map((p) =>
                paidAtById.has(p.id)
                  ? { ...p, status: "PAID" as const, paid_at: paidAtById.get(p.id)! }
                  : p
              ),
            }
          : prev
      );
      toast.success(
        `Marked ${result.data.marked} payment${
          result.data.marked !== 1 ? "s" : ""
        } paid — ${formatCurrency(result.data.totalAmount)}`
      );
      setBulkIds(new Set());
      setBulkConfirmOpen(false);
    } else {
      toast.error(result.error ?? "Couldn't mark the payments as paid");
    }
  }

  function openDetail(p: PaymentItem) {
    setDetailId(p.id);
    setNoteDraft(p.payment_note ?? "");
  }

  async function saveNote() {
    if (!detail) return;
    setNoteSaving(true);
    const result = await updatePaymentNote(detail.id, noteDraft);
    setNoteSaving(false);
    if (result.success) {
      patchHistoryRow(detail.id, { payment_note: result.data!.payment_note });
      toast.success("Note saved");
      setDetailId(null);
    } else {
      toast.error(result.error ?? "Couldn't save the note");
    }
  }

  async function handleCreatePayment() {
    if (!createEmployeeId || selectedTasks.size === 0) return;
    setCreating(true);
    const result = await createPaymentFromTasks(
      createEmployeeId,
      Array.from(selectedTasks.entries()).map(([task_id, amount]) => ({ task_id, amount })),
      paymentNote.trim() || undefined
    );
    setCreating(false);
    if (result.success && result.data) {
      toast.success(
        `Payment recorded for ${result.data.employee_name} — ${formatCurrency(result.data.totalAmount)}`,
        { description: `${result.data.created} task payment${result.data.created !== 1 ? "s" : ""} created.` }
      );
      setConfirmOpen(false);
      setCreateOpen(false);
      setSelectedTasks(new Map());
      setPaymentNote("");
      void queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't create the payment");
    }
  }

  async function handleCreateCustom() {
    setCustomSaving(true);
    const result = await createCustomPayment(
      createEmployeeId,
      Number(customAmount),
      customDescription,
      customMarkPaid,
      paymentNote.trim() || undefined
    );
    setCustomSaving(false);
    if (result.success && result.data) {
      toast.success(
        `Custom payment (${formatCurrency(result.data.amount)}) ${
          result.data.status === "PAID" ? "recorded as paid" : "created as pending"
        } for ${result.data.employee_name}`
      );
      setCreateOpen(false);
      setCustomAmount("");
      setCustomDescription("");
      setCustomMarkPaid(false);
      setPaymentNote("");
      void queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
    } else {
      toast.error(result.error ?? "Couldn't create the payment");
    }
  }

  // ────────────────────────────────────────────
  // Employee list for the create sheet (cached)
  // ────────────────────────────────────────────

  const employeeOptions = useMemo(() => {
    const fromCache = (employeesQuery.data ?? []).map((e) => ({
      id: e.id,
      name: e.full_name,
      avatar_url: e.avatar_url,
    }));
    const fromWorkspace = employeeRows.map((e) => ({
      id: e.id,
      name: e.name,
      avatar_url: avatarById.get(e.id) ?? null,
    }));
    const merged = new Map<string, { id: string; name: string; avatar_url: string | null }>();
    for (const e of fromWorkspace) merged.set(e.id, e);
    for (const e of fromCache) merged.set(e.id, e);
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [employeesQuery.data, employeeRows, avatarById]);

  const filteredEmployeeOptions = useMemo(() => {
    const q = createSearch.trim().toLowerCase();
    if (!q) return employeeOptions;
    return employeeOptions.filter((e) => e.name.toLowerCase().includes(q));
  }, [employeeOptions, createSearch]);

  const createEmployee = employeeOptions.find((e) => e.id === createEmployeeId) ?? null;
  const createEmployeeName = createEmployee?.name ?? "";

  function openCreateSheet(prefillEmployeeId?: string) {
    setCreateEmployeeId(prefillEmployeeId ?? "");
    setCreateType("TASK");
    setCreateSearch("");
    setTaskSearch("");
    setSelectedTasks(new Map());
    setPaymentNote("");
    setCustomAmount("");
    setCustomDescription("");
    setCustomMarkPaid(false);
    setCreateOpen(true);
  }

  const tasksQuery = useQuery(payableTasksOptions(createEmployeeId));

  const visibleTasks = useMemo(() => {
    const tasks = tasksQuery.data ?? [];
    const q = taskSearch.trim().toLowerCase();
    return tasks
      .filter((t) => (unpaidOnly ? !t.has_payment : true))
      .filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          (t.project_name ?? "").toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          TASK_STATUS_ORDER.indexOf(a.status as TaskStatus) -
            TASK_STATUS_ORDER.indexOf(b.status as TaskStatus) ||
          a.title.localeCompare(b.title)
      );
  }, [tasksQuery.data, unpaidOnly, taskSearch]);

  const selectedEntries = useMemo(
    () =>
      (tasksQuery.data ?? [])
        .filter((t) => selectedTasks.has(t.id))
        .map((t) => ({ task: t, amount: selectedTasks.get(t.id) ?? t.payout_amount })),
    [tasksQuery.data, selectedTasks]
  );
  const selectedTotal = selectedEntries.reduce((s, e) => s + e.amount, 0);

  function toggleTask(id: string) {
    setSelectedTasks((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else {
        const task = (tasksQuery.data ?? []).find((t) => t.id === id);
        if (task && task.payout_amount > 0) next.set(id, task.payout_amount);
      }
      return next;
    });
  }

  function setTaskAmount(id: string, amount: number) {
    setSelectedTasks((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, Math.max(0, amount));
      return next;
    });
  }

  const allVisibleSelected =
    visibleTasks.length > 0 && visibleTasks.every((t) => selectedTasks.has(t.id));

  function toggleSelectAllTasks() {
    setSelectedTasks((prev) => {
      if (allVisibleSelected) {
        const next = new Map(prev);
        for (const t of visibleTasks) next.delete(t.id);
        return next;
      }
      const next = new Map(prev);
      for (const t of visibleTasks) {
        if (!t.has_payment && t.payout_amount > 0) next.set(t.id, t.payout_amount);
      }
      return next;
    });
  }

  // ────────────────────────────────────────────
  // Render helpers
  // ────────────────────────────────────────────

  const employeesOwed = employeeRows.filter((e) => e.pending > 0).length;

  const selectItems = {
    type: { ALL: "All types", TASK: "Task payouts", CUSTOM: "Custom payments" },
    date: { ALL: "All dates", WEEK: "This week", MONTH: "This month", QUARTER: "This quarter" },
    sort: {
      NEWEST: "Newest",
      OLDEST: "Oldest",
      AMOUNT_DESC: "Amount: high to low",
      AMOUNT_ASC: "Amount: low to high",
    },
  };

  const employeeFilterItems = useMemo(
    () => Object.fromEntries(employeeOptions.map((e) => [e.id, e.name])),
    [employeeOptions]
  );

  /** Desktop payments table row. */
  function PaymentRow({ p }: { p: PaymentItem }) {
    const rd = rowDate(p);
    const isBulkable = p.status === "PENDING";
    return (
      <TableRow
        className={cn(bulkIds.has(p.id) && "bg-accent/40")}
        onClick={() => openDetail(p)}
      >
        <TableCell onClick={(e) => e.stopPropagation()} className="w-8 pr-0">
          {isBulkable && (
            <Checkbox
              checked={bulkIds.has(p.id)}
              onCheckedChange={() =>
                setBulkIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                })
              }
              aria-label={`Select payment for ${p.employee_name ?? "employee"}`}
            />
          )}
        </TableCell>
        <TableCell className="max-w-52">
          <p className="truncate font-medium">{p.label}</p>
          {p.payment_note && (
            <p className="truncate text-xs text-muted-foreground">{p.payment_note}</p>
          )}
        </TableCell>
        <TableCell>
          <EmployeeCell name={p.employee_name} avatarUrl={avatarById.get(p.employee_id ?? "")} />
        </TableCell>
        <TableCell>
          <PaymentKindBadge kind={p.kind} />
        </TableCell>
        <TableCell className="max-w-44">
          {p.project_name ? (
            <>
              <p className="truncate text-sm">{p.project_name}</p>
              {p.client_name && (
                <p className="truncate text-xs text-muted-foreground">{p.client_name}</p>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          {formatCurrency(p.amount)}
        </TableCell>
        <TableCell>
          <PaymentStatusBadge status={p.status} />
        </TableCell>
        <TableCell className="text-right">
          <p className="text-sm">{rd.date ? formatDate(rd.date) : "—"}</p>
          <p className="text-[11px] text-muted-foreground">{rd.date ? rd.label : ""}</p>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()} className="w-10 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Payment actions"
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => openDetail(p)}>
                <Eye className="size-4" /> View details
              </DropdownMenuItem>
              {p.status === "PENDING" && (
                <DropdownMenuItem onClick={() => void handleMarkPaid(p)}>
                  <CheckCheck className="size-4" /> Mark as paid
                </DropdownMenuItem>
              )}
              {p.kind === "TASK" && p.task_id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push(`/tasks/${p.task_id}`)}>
                    <ChevronRight className="size-4" /> Open task
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  }

  /** Compact payment record card (mobile). */
  function PaymentCard({ p }: { p: PaymentItem }) {
    const rd = rowDate(p);
    return (
      <div
        className={cn(
          "px-4 py-3 transition-colors",
          bulkIds.has(p.id) && "bg-accent/40"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {p.status === "PENDING" && (
              <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={bulkIds.has(p.id)}
                  onCheckedChange={() =>
                    setBulkIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                  aria-label={`Select payment for ${p.employee_name ?? "employee"}`}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => openDetail(p)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-sm font-medium">{p.label}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {p.employee_name ?? "—"} · {p.kind === "TASK" ? "Task payout" : "Custom"}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {p.project_name && <span>{p.project_name}</span>}
                {rd.date && (
                  <span>
                    {rd.label} {formatDate(rd.date)}
                  </span>
                )}
              </p>
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">{formatCurrency(p.amount)}</p>
              <div className="mt-0.5 flex justify-end">
                <PaymentStatusBadge status={p.status} />
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Payment actions"
              >
                <Ellipsis className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => openDetail(p)}>
                  <Eye className="size-4" /> View details
                </DropdownMenuItem>
                {p.status === "PENDING" && (
                  <DropdownMenuItem onClick={() => void handleMarkPaid(p)}>
                    <CheckCheck className="size-4" /> Mark as paid
                  </DropdownMenuItem>
                )}
                {p.kind === "TASK" && p.task_id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => router.push(`/tasks/${p.task_id}`)}>
                      <ChevronRight className="size-4" /> Open task
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    );
  }

  const bulkBar = bulkIds.size > 0 && (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
      <p className="text-sm">
        <span className="font-semibold">{bulkIds.size}</span> selected ·{" "}
        <span className="font-semibold tabular-nums">{formatCurrency(bulkTotal)}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => setBulkConfirmOpen(true)}>
          <CheckCheck className="size-4" /> Mark as paid
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setBulkIds(new Set())}
        >
          Clear
        </Button>
      </div>
    </div>
  );

  const pendingSelectHint =
    bulkIds.size === 0 && counts.pending > 1 ? (
      <button
        type="button"
        onClick={() => setBulkIds(new Set(history.filter((p) => p.status === "PENDING").map((p) => p.id)))}
        className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Select {counts.pending} pending
      </button>
    ) : null;

  // ────────────────────────────────────────────
  // Loading / error / empty
  // ────────────────────────────────────────────

  if (isLoading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="h-9 w-36 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3.5 w-20 animate-pulse rounded bg-muted" />
              <div className="h-7 w-28 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
        <SkeletonList rows={6} />
      </div>
    );
  }

  if (isError || !data || !summary) {
    return (
      <div className="rounded-xl border bg-card px-4 py-12 text-center">
        <p className="text-sm font-medium">Couldn&apos;t load payments</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const showTable = filtered.length > 0;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage employee payouts, task-based payments and custom payments.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => openCreateSheet()}>
          <Plus className="size-4" /> Create payment
        </Button>
      </div>

      {/* ── Metrics strip ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y py-4 lg:grid-cols-4">
        <Metric
          label="Pending payout"
          amount={summary.pendingTotal}
          sub={`${summary.pendingCount} payment${summary.pendingCount !== 1 ? "s" : ""}`}
          tone="pending"
        />
        <Metric
          label="Paid this week"
          amount={summary.paidThisWeek}
          sub={`${counts.paid} payment${counts.paid !== 1 ? "s" : ""} total`}
        />
        <Metric
          label="Paid this month"
          amount={summary.paidThisMonth}
          sub={
            summary.paidThisMonth > 0 && summary.paidTotal > 0
              ? `${Math.round((summary.paidThisMonth / summary.paidTotal) * 100)}% of all time`
              : "—"
          }
        />
        <Metric label="Total paid" amount={summary.paidTotal} sub="All time" />
      </div>

      {/* ── Workspace tabs ─────────────────────────────────── */}
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab((v ?? "payments") as WorkspaceTab);
          setBulkIds(new Set());
        }}
      >
        <TabsList>
          <TabsTrigger value="payments">All {counts.all}</TabsTrigger>
          <TabsTrigger value="pending">Pending {counts.pending}</TabsTrigger>
          <TabsTrigger value="paid">Paid {counts.paid}</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab !== "employees" && (
        <div className="space-y-3">
          {/* ── Toolbar ─────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-44 flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search payments…"
                className="pl-9"
                aria-label="Search payments"
              />
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <Select
                items={employeeFilterItems}
                value={employeeFilter}
                onValueChange={(v) => setEmployeeFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All employees</SelectItem>
                  {employeeOptions.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={selectItems.type}
                value={typeFilter}
                onValueChange={(v) => setTypeFilter((v ?? "ALL") as TypeFilter)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(selectItems.type).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={selectItems.date}
                value={dateFilter}
                onValueChange={(v) => setDateFilter((v ?? "ALL") as DateFilter)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(selectItems.date).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={selectItems.sort}
                value={sortKey}
                onValueChange={(v) => setSortKey((v ?? "NEWEST") as SortKey)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(selectItems.sort).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {pendingSelectHint}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal className="size-4" /> Filters
                {filtersActive && <span className="size-1.5 rounded-full bg-primary" />}
              </Button>
            </div>
          </div>

          {filtersActive && (
            <div className="flex flex-wrap items-center gap-2">
              {employeeFilter !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setEmployeeFilter("ALL")}
                  className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  {employeeFilterItems[employeeFilter] ?? "Employee"} ✕
                </button>
              )}
              {typeFilter !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setTypeFilter("ALL")}
                  className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  {selectItems.type[typeFilter]} ✕
                </button>
              )}
              {dateFilter !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setDateFilter("ALL")}
                  className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  {selectItems.date[dateFilter]} ✕
                </button>
              )}
              {search.trim() && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  “{search.trim()}” ✕
                </button>
              )}
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}

          {bulkBar}

          {/* ── Empty state ─────────────────────────────────── */}
          {!showTable ? (
            <div className="rounded-xl border bg-card px-4 py-12 text-center">
              <Inbox className="mx-auto size-8 text-muted-foreground/60" />
              {filtersActive || tabStatus !== "ALL" ? (
                <>
                  <p className="mt-3 text-sm font-medium">No payments match your filters</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Adjust or clear the filters to see more records.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      clearFilters();
                      if (tabStatus !== "ALL") setTab("payments");
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              ) : counts.pending > 0 ? (
                <>
                  <p className="mt-3 text-sm font-medium">No pending payouts</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    All employee payouts are currently settled.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setTab("payments")}
                  >
                    View all payments
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm font-medium">No payments yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create the first payout for your team.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-4"
                    onClick={() => openCreateSheet()}
                  >
                    <Plus className="size-4" /> Create payment
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* ── Desktop table ─────────────────────────────── */}
              <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-8" />
                      <TableHead>Payment</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Date</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => (
                      <PaymentRow key={p.id} p={p} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ── Mobile cards ──────────────────────────────── */}
              <div className="divide-y rounded-xl border bg-card lg:hidden">
                {filtered.map((p) => (
                  <PaymentCard key={p.id} p={p} />
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                {filtered.length} of {history.length} payment
                {history.length !== 1 ? "s" : ""}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Employees tab ────────────────────────────────────── */}
      {tab === "employees" && (
        <div className="space-y-3">
          {employeeRows.length === 0 ? (
            <div className="rounded-xl border bg-card px-4 py-12 text-center">
              <UserRound className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No employees yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Approved employees will appear here with their payout summary.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">This month</TableHead>
                      <TableHead className="text-right">Total paid</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...employeeRows]
                      .sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name))
                      .map((e) => (
                        <TableRow
                          key={e.id}
                          className="cursor-pointer"
                          onClick={() => setEmployeeSheetId(e.id)}
                        >
                          <TableCell>
                            <EmployeeCell
                              name={e.name}
                              avatarUrl={avatarById.get(e.id)}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            {e.pending > 0 ? (
                              <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                                {formatCurrency(e.pending)}
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  {e.pendingCount} payment{e.pendingCount !== 1 ? "s" : ""}
                                </span>
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(e.paidThisMonth)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(e.paidTotal)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            <ChevronRight className="ml-auto size-4" />
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile employee cards */}
              <div className="divide-y rounded-xl border bg-card md:hidden">
                {[...employeeRows]
                  .sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name))
                  .map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEmployeeSheetId(e.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.pending > 0
                            ? `${formatCurrency(e.pending)} pending · ${e.pendingCount} payment${e.pendingCount !== 1 ? "s" : ""}`
                            : "Nothing pending"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatCurrency(e.paidTotal)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">total paid</p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
              </div>

              <p className="text-xs text-muted-foreground">
                {employeesOwed} employee{employeesOwed !== 1 ? "s" : ""} currently owed money
              </p>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          Sheets & dialogs
         ══════════════════════════════════════════════════════ */}

      {/* ── Create payment sheet ────────────────────────────── */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="border-b pb-4">
            <SheetTitle className="text-base font-semibold">Create payment</SheetTitle>
            <SheetDescription>
              Task payouts settle completed work; custom payments cover bonuses and adjustments.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {/* Step 1 — employee */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Employee
              </h3>
              {createEmployee ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
                  <EmployeeCell
                    name={createEmployee.name}
                    avatarUrl={createEmployee.avatar_url}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCreateEmployeeId("");
                      setSelectedTasks(new Map());
                    }}
                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={createSearch}
                      onChange={(e) => setCreateSearch(e.target.value)}
                      placeholder="Search employees…"
                      className="pl-9"
                      aria-label="Search employees"
                    />
                  </div>
                  <div className="max-h-52 divide-y overflow-y-auto rounded-lg border">
                    {filteredEmployeeOptions.length === 0 ? (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No employees match “{createSearch.trim()}”.
                      </p>
                    ) : (
                      filteredEmployeeOptions.map((e) => {
                        const row = employeeRows.find((r) => r.id === e.id);
                        return (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                              setCreateEmployeeId(e.id);
                              setCreateSearch("");
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                          >
                            <EmployeeCell name={e.name} avatarUrl={e.avatar_url} />
                            {row && row.pending > 0 && (
                              <span className="shrink-0 text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400">
                                {formatCurrency(row.pending)} pending
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </section>

            {createEmployee && (
              <>
                {/* Step 2 — payment type */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment type
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateType("TASK")}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        createType === "TASK"
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/40"
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Banknote className="size-4" /> Task payout
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Settle selected tasks
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateType("CUSTOM")}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        createType === "CUSTOM"
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/40"
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Sparkles className="size-4" /> Custom payment
                      </span>
                      <span className="text-xs text-muted-foreground">Bonus or adjustment</span>
                    </button>
                  </div>
                </section>

                {/* Step 3a — task selection */}
                {createType === "TASK" ? (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Eligible tasks
                      </h3>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          checked={unpaidOnly}
                          onCheckedChange={(v) => setUnpaidOnly(v === true)}
                        />
                        Unpaid only
                      </label>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={taskSearch}
                        onChange={(e) => setTaskSearch(e.target.value)}
                        placeholder="Search tasks…"
                        className="pl-9"
                        aria-label="Search tasks"
                      />
                    </div>

                    {tasksQuery.isLoading ? (
                      <SkeletonList rows={3} />
                    ) : tasksQuery.isError ? (
                      <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
                        Couldn&apos;t load tasks. Try again.
                      </p>
                    ) : visibleTasks.length === 0 ? (
                      <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
                        {taskSearch
                          ? "No tasks match your search."
                          : unpaidOnly
                            ? "No unpaid tasks for this employee."
                            : "No active tasks for this employee."}
                      </p>
                    ) : (
                      <div className="divide-y rounded-lg border">
                        <div className="flex items-center justify-between px-3 py-1.5">
                          <button
                            type="button"
                            onClick={toggleSelectAllTasks}
                            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {allVisibleSelected ? "Deselect all" : "Select all"}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {selectedTasks.size} selected
                          </span>
                        </div>
                        {visibleTasks.map((t) => {
                          const isSelected = selectedTasks.has(t.id);
                          const amount = selectedTasks.get(t.id) ?? t.payout_amount;
                          const status = t.status as TaskStatus;
                          return (
                            <div
                              key={t.id}
                              className={cn(
                                "flex items-center gap-3 px-3 py-2.5 transition-colors",
                                isSelected && "bg-accent/40"
                              )}
                            >
                              {t.has_payment ? (
                                <span
                                  className="flex size-4 shrink-0 items-center justify-center"
                                  title="Already has a payment"
                                >
                                  <BadgeCheck className="size-4 text-emerald-500" />
                                </span>
                              ) : (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleTask(t.id)}
                                  aria-label={`Select ${t.title}`}
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{t.title}</p>
                                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                  <span
                                    className={cn(
                                      "size-1.5 shrink-0 rounded-full",
                                      TASK_STATUS_DOTS[status] ?? "bg-muted"
                                    )}
                                  />
                                  {TASK_STATUS_LABELS[status] ?? t.status}
                                  {t.project_name ? ` · ${t.project_name}` : ""}
                                  {t.deadline ? ` · ${formatDate(t.deadline)}` : ""}
                                </p>
                              </div>
                              <Input
                                type="number"
                                min="0"
                                step="50"
                                value={String(isSelected ? amount : t.payout_amount)}
                                disabled={!isSelected}
                                onChange={(e) => setTaskAmount(t.id, Number(e.target.value))}
                                className="h-7 w-20 shrink-0 text-right text-sm tabular-nums"
                                aria-label={`Amount for ${t.title}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : (
                  /* Step 3b — custom payment form */
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Custom payment details
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label
                          className="text-xs font-medium text-muted-foreground"
                          htmlFor="custom-amount"
                        >
                          Amount (₹) *
                        </label>
                        <Input
                          id="custom-amount"
                          type="number"
                          min="0"
                          step="50"
                          placeholder="2000"
                          value={customAmount}
                          onChange={(e) => setCustomAmount(e.target.value)}
                        />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={customMarkPaid}
                            onCheckedChange={(v) => setCustomMarkPaid(v === true)}
                          />
                          Mark as paid now
                        </label>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        className="text-xs font-medium text-muted-foreground"
                        htmlFor="custom-desc"
                      >
                        Description *
                      </label>
                      <Textarea
                        id="custom-desc"
                        rows={2}
                        placeholder="e.g. Monthly performance bonus"
                        value={customDescription}
                        onChange={(e) => setCustomDescription(e.target.value)}
                      />
                    </div>
                  </section>
                )}

                {/* Shared note */}
                <section className="space-y-1.5">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="payment-note-input"
                  >
                    Note (optional)
                  </label>
                  <Input
                    id="payment-note-input"
                    placeholder="e.g. September weekly payout"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                  />
                </section>
              </>
            )}
          </div>

          {/* Sticky footer */}
          {createEmployee && (
            <SheetFooter className="border-t">
              <div className="flex w-full items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  {createType === "TASK" ? (
                    selectedTasks.size > 0 ? (
                      <>
                        <span className="font-semibold">{selectedTasks.size}</span> task
                        {selectedTasks.size !== 1 ? "s" : ""} ·{" "}
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(selectedTotal)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Select tasks to continue</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">
                      {Number(customAmount) > 0
                        ? `${formatCurrency(Number(customAmount))} · ${createEmployee.name}`
                        : "Enter an amount"}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  disabled={
                    createType === "TASK"
                      ? selectedTasks.size === 0 || selectedTotal <= 0
                      : !(Number(customAmount) > 0) || !customDescription.trim()
                  }
                  onClick={() =>
                    createType === "TASK" ? setConfirmOpen(true) : void handleCreateCustom()
                  }
                >
                  {customSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                  Review &amp; create
                </Button>
              </div>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Confirm task-payment dialog ─────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create payment for {createEmployeeName}?</DialogTitle>
            <DialogDescription>
              {selectedTasks.size} task payment{selectedTasks.size !== 1 ? "s" : ""} · Employees
              are notified once the payout is recorded.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 divide-y overflow-y-auto rounded-lg border bg-card text-sm">
            {selectedEntries.map(({ task, amount }) => (
              <div key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                <span className="shrink-0 font-medium tabular-nums">{formatCurrency(amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(selectedTotal)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreatePayment()}
              disabled={creating || selectedTotal <= 0}
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
              Create payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Payment detail sheet ────────────────────────────── */}
      <Sheet open={!!detail} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b pb-4">
            <SheetTitle className="text-base font-semibold">Payment details</SheetTitle>
            <SheetDescription>
              {detail?.kind === "TASK" ? "Task payout" : "Custom payment"}
              {detail?.employee_name ? ` · ${detail.employee_name}` : ""}
            </SheetDescription>
          </SheetHeader>

          {detail && (
            <>
              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums tracking-tight">
                      {formatCurrency(detail.amount)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {detail.label}
                    </p>
                  </div>
                  <PaymentStatusBadge status={detail.status} />
                </div>

                <dl className="space-y-3 rounded-lg border bg-card px-3.5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Employee</dt>
                    <dd className="font-medium">{detail.employee_name ?? "—"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd>
                      <PaymentKindBadge kind={detail.kind} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{detail.created_at ? formatDate(detail.created_at) : "—"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd>{detail.paid_at ? formatDate(detail.paid_at) : "—"}</dd>
                  </div>
                  {detail.kind === "TASK" && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="shrink-0 text-muted-foreground">Task</dt>
                      <dd className="text-right">
                        {detail.task_id ? (
                          <Link
                            href={`/tasks/${detail.task_id}`}
                            className="font-medium hover:underline"
                            onClick={() => setDetailId(null)}
                          >
                            {detail.label}
                          </Link>
                        ) : (
                          detail.label
                        )}
                      </dd>
                    </div>
                  )}
                  {(detail.project_name || detail.client_name) && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="shrink-0 text-muted-foreground">Project</dt>
                      <dd className="text-right">
                        {detail.project_name ?? "—"}
                        {detail.client_name && (
                          <span className="block text-xs text-muted-foreground">
                            {detail.client_name}
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="space-y-1.5">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="payment-note-edit"
                  >
                    Note
                  </label>
                  <Textarea
                    id="payment-note-edit"
                    rows={2}
                    placeholder="e.g. Monthly bonus, advance payment…"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={noteSaving || noteDraft === (detail.payment_note ?? "")}
                      onClick={() => void saveNote()}
                    >
                      <Pencil className="size-3.5" />
                      {noteSaving ? "Saving…" : "Save note"}
                    </Button>
                  </div>
                </div>
              </div>

              {detail.status === "PENDING" && (
                <SheetFooter className="border-t">
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleMarkPaid(detail)}
                  >
                    <CheckCheck className="size-4" /> Mark as paid
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Employee payout detail sheet ────────────────────── */}
      <Sheet open={!!employeeSheetId} onOpenChange={(open) => !open && setEmployeeSheetId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b pb-4">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{getInitials(detailEmployeeSheet?.name ?? "?")}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <SheetTitle className="truncate text-base font-semibold">
                  {detailEmployeeSheet?.name ?? "Employee"}
                </SheetTitle>
                <SheetDescription className="truncate">
                  {employeeDetailQuery.data?.email ?? "Employee payout summary"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {detailEmployeeSheet && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Pending</p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-semibold tabular-nums",
                      detailEmployeeSheet.pending > 0 &&
                        "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {formatCurrency(detailEmployeeSheet.pending)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">This month</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {formatCurrency(detailEmployeeSheet.paidThisMonth)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total paid</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {formatCurrency(detailEmployeeSheet.paidTotal)}
                  </p>
                </div>
              </div>
            )}

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                const id = employeeSheetId;
                setEmployeeSheetId(null);
                openCreateSheet(id ?? undefined);
              }}
            >
              <Plus className="size-4" /> Create payment
            </Button>

            {/* Pending payouts */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pending payouts
              </h3>
              {(() => {
                const rows = employeeHistory.filter((p) => p.status === "PENDING");
                if (rows.length === 0)
                  return (
                    <p className="rounded-lg border px-3 py-4 text-center text-xs text-muted-foreground">
                      Nothing pending — all payouts are settled.
                    </p>
                  );
                return (
                  <div className="divide-y rounded-lg border bg-card">
                    {rows.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setEmployeeSheetId(null);
                          openDetail(p);
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{p.label}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.kind === "TASK" ? "Task payout" : "Custom"}
                            {p.project_name ? ` · ${p.project_name}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                          {formatCurrency(p.amount)}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </section>

            {/* Payment history */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Payment history
              </h3>
              {employeeHistory.length === 0 ? (
                <p className="rounded-lg border px-3 py-4 text-center text-xs text-muted-foreground">
                  No payments for this employee yet.
                </p>
              ) : (
                <div className="divide-y rounded-lg border bg-card">
                  {employeeHistory
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(rowDate(b).date ?? 0).getTime() -
                        new Date(rowDate(a).date ?? 0).getTime()
                    )
                    .map((p) => {
                      const rd = rowDate(p);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setEmployeeSheetId(null);
                            openDetail(p);
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{p.label}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {rd.date ? `${rd.label} ${formatDate(rd.date)}` : "Pending"}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {formatCurrency(p.amount)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Bulk mark-paid confirmation ─────────────────────── */}
      <Dialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {bulkIds.size} payment{bulkIds.size !== 1 ? "s" : ""} as paid?
            </DialogTitle>
            <DialogDescription>
              Employees are notified for each payout. This can&apos;t be undone from here.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 divide-y overflow-y-auto rounded-lg border bg-card text-sm">
            {history
              .filter((p) => bulkIds.has(p.id))
              .map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">
                    {p.employee_name ?? "—"} · {p.label}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatCurrency(p.amount)}</span>
                </div>
              ))}
            <div className="flex items-center justify-between px-3 py-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(bulkTotal)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkConfirmOpen(false)}
              disabled={bulkWorking}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void runBulkMarkPaid()} disabled={bulkWorking}>
              {bulkWorking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCheck className="size-4" />
              )}
              Mark {bulkIds.size} paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mobile filter sheet ─────────────────────────────── */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle className="text-base font-semibold">Filters</SheetTitle>
            <SheetDescription>Filter the payment list.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Employee</label>
              <Select
                items={employeeFilterItems}
                value={employeeFilter}
                onValueChange={(v) => setEmployeeFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All employees</SelectItem>
                  {employeeOptions.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Payment type</label>
              <Select
                items={selectItems.type}
                value={typeFilter}
                onValueChange={(v) => setTypeFilter((v ?? "ALL") as TypeFilter)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(selectItems.type).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Date</label>
              <Select
                items={selectItems.date}
                value={dateFilter}
                onValueChange={(v) => setDateFilter((v ?? "ALL") as DateFilter)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(selectItems.date).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Sort</label>
              <Select
                items={selectItems.sort}
                value={sortKey}
                onValueChange={(v) => setSortKey((v ?? "NEWEST") as SortKey)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(selectItems.sort).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                clearFilters();
                setFiltersOpen(false);
              }}
            >
              Clear
            </Button>
            <Button type="button" className="flex-1" onClick={() => setFiltersOpen(false)}>
              Show {filtered.length} payment{filtered.length !== 1 ? "s" : ""}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
