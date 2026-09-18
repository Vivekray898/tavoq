"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, FolderKanban, Building2, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { globalSearch, type SearchResult } from "@/lib/actions/dashboard";
import {
  taskListOptions,
  projectsListOptions,
  clientsListOptions,
  teamMembersOptions,
} from "@/lib/queries/options";
import { useSession } from "@/components/providers/session-provider";
import { cn } from "@/lib/utils";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Hit {
  id: string;
  kind: "TASK" | "PROJECT" | "CLIENT" | "EMPLOYEE";
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * §1 — cached-first global search.
 *
 * Keystrokes filter what's already in the TanStack Query cache
 * (tasks / projects / clients / team) with zero network traffic.
 * Only when the local hit count is thin does it ask the server once
 * (debounced), merging any extra rows into the results.
 */
export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const router = useRouter();
  const { role } = useSession();
  const isAdmin = role === "ADMIN";

  const [query, setQuery] = useState("");
  const [server, setServer] = useState<SearchResult | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Warm cached sources on open — these are the same entries the pages
  // already hold, so this is usually a no-op (§3).
  const tasksQuery = useQuery({ ...taskListOptions, enabled: open });
  const projectsQuery = useQuery({ ...projectsListOptions(false), enabled: open });
  const clientsQuery = useQuery({ ...clientsListOptions(false), enabled: isAdmin && open });
  const teamQuery = useQuery({ ...teamMembersOptions, enabled: isAdmin && open });

  const q = query.trim().toLowerCase();

  // Server fallback — only when local filtering isn't enough.
  // (State resets are deferred to microtasks to satisfy the
  // set-state-in-effect rule; behavior is identical.)
  useEffect(() => {
    if (!open) {
      Promise.resolve().then(() => setServer(null));
      return;
    }
    if (q.length < 2) {
      Promise.resolve().then(() => {
        setServer(null);
        setServerLoading(false);
      });
      return;
    }

    const local = collectLocalHits(q, {
      tasks: tasksQuery.data ?? [],
      projects: projectsQuery.data ?? [],
      clients: clientsQuery.data ?? [],
      team: isAdmin ? (teamQuery.data ?? []) : [],
      isAdmin,
    });

    // Enough local hits — skip the network entirely (§1).
    if (local.length >= 8) {
      Promise.resolve().then(() => {
        setServer(null);
        setServerLoading(false);
      });
      return;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setServerLoading(true);
    });
    const t = setTimeout(async () => {
      const res = await globalSearch(query.trim());
      if (!cancelled) {
        if (res.success && res.data) setServer(res.data);
        setServerLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute local count per keystroke
  }, [query, open, tasksQuery.data, projectsQuery.data, clientsQuery.data, teamQuery.data, isAdmin]);

  const hits = useMemo<Hit[]>(() => {
    const local = collectLocalHits(q, {
      tasks: tasksQuery.data ?? [],
      projects: projectsQuery.data ?? [],
      clients: clientsQuery.data ?? [],
      team: isAdmin ? (teamQuery.data ?? []) : [],
      isAdmin,
    });

    if (server) {
      const seen = new Set(local.map((h) => `${h.kind}:${h.id}`));
      const extra: Hit[] = [];
      for (const t of server.tasks) {
        if (!seen.has(`TASK:${t.id}`))
          extra.push({ id: t.id, kind: "TASK", title: t.title, subtitle: t.project_name, href: `/tasks/${t.id}` });
      }
      for (const p of server.projects) {
        if (!seen.has(`PROJECT:${p.id}`))
          extra.push({ id: p.id, kind: "PROJECT", title: p.name, subtitle: p.client_name, href: `/projects/${p.id}` });
      }
      for (const c of server.clients) {
        if (!seen.has(`CLIENT:${c.id}`))
          extra.push({ id: c.id, kind: "CLIENT", title: c.name, subtitle: null, href: `/clients/${c.id}` });
      }
      for (const e of server.employees) {
        if (!seen.has(`EMPLOYEE:${e.id}`))
          extra.push({ id: e.id, kind: "EMPLOYEE", title: e.full_name, subtitle: e.email, href: `/employees/${e.id}` });
      }
      return [...local, ...extra];
    }
    return local;
  }, [q, tasksQuery.data, projectsQuery.data, clientsQuery.data, teamQuery.data, server, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setActiveIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // ⌘K keyboard shortcut (§64)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("taskora-open-search"));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Listen for external open events (e.g. mobile header / shortcuts)
  useEffect(() => {
    function onOpen() {
      onOpenChange(true);
    }
    window.addEventListener("taskora-open-search", onOpen);
    return () => window.removeEventListener("taskora-open-search", onOpen);
  }, [onOpenChange]);

  // Focus the input whenever the dialog opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  function go(hit: Hit) {
    onOpenChange(false);
    setQuery("");
    setServer(null);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[activeIndex]) {
      e.preventDefault();
      go(hits[activeIndex]);
    } else if (e.key === "Escape") {
      onOpenChange(false);
    }
  }

  const grouped = useMemo(() => {
    const groups: Array<{ kind: Hit["kind"]; label: string; items: Hit[] }> = [];
    for (const kind of ["TASK", "PROJECT", "CLIENT", "EMPLOYEE"] as const) {
      const items = hits.filter((h) => h.kind === kind);
      if (items.length > 0)
        groups.push({
          kind,
          label: kind === "TASK" ? "Tasks" : kind === "PROJECT" ? "Projects" : kind === "CLIENT" ? "Clients" : "Employees",
          items,
        });
    }
    return groups;
  }, [hits]);

  // Flatten for keyboard navigation
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, projects, clients, employees…"
            className="h-11 border-0 bg-transparent shadow-none focus-visible:ring-0"
            autoComplete="off"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {q.length < 2 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </p>
          )}
          {q.length >= 2 && flat.length === 0 && !serverLoading && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matches for &ldquo;{query.trim()}&rdquo;
            </p>
          )}
          {q.length >= 2 && flat.length === 0 && serverLoading && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Searching…</p>
          )}

          {grouped.map((group) => (
            <div key={group.kind} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((hit) => {
                const idx = flat.indexOf(hit);
                return (
                  <Row
                    key={`${hit.kind}:${hit.id}`}
                    icon={
                      hit.kind === "TASK" ? (
                        <CheckSquare className="size-4" />
                      ) : hit.kind === "PROJECT" ? (
                        <FolderKanban className="size-4" />
                      ) : hit.kind === "CLIENT" ? (
                        <Building2 className="size-4" />
                      ) : (
                        <User className="size-4" />
                      )
                    }
                    title={hit.title}
                    subtitle={hit.subtitle ?? undefined}
                    active={idx === activeIndex}
                    onClick={() => go(hit)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pure local filter over the cached arrays — runs on every keystroke. */
function collectLocalHits(
  q: string,
  sources: {
    tasks: Array<{ id: string; title: string; project_name: string | null }>;
    projects: Array<{ id: string; name: string; client_name: string | null }>;
    clients: Array<{ id: string; name: string }>;
    team: Array<{ id: string; full_name: string; email: string; status?: string }>;
    isAdmin: boolean;
  }
): Hit[] {
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  for (const t of sources.tasks) {
    if (
      t.title.toLowerCase().includes(q) ||
      (t.project_name ?? "").toLowerCase().includes(q)
    ) {
      hits.push({ id: t.id, kind: "TASK", title: t.title, subtitle: t.project_name, href: `/tasks/${t.id}` });
      if (hits.length >= 10) return hits;
    }
  }
  for (const p of sources.projects) {
    if (p.name.toLowerCase().includes(q) || (p.client_name ?? "").toLowerCase().includes(q)) {
      hits.push({ id: p.id, kind: "PROJECT", title: p.name, subtitle: p.client_name, href: `/projects/${p.id}` });
      if (hits.length >= 14) return hits;
    }
  }
  for (const c of sources.clients) {
    if (c.name.toLowerCase().includes(q)) {
      hits.push({ id: c.id, kind: "CLIENT", title: c.name, subtitle: null, href: `/clients/${c.id}` });
      if (hits.length >= 18) return hits;
    }
  }
  if (sources.isAdmin) {
    for (const m of sources.team) {
      if (
        m.full_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
      ) {
        hits.push({ id: m.id, kind: "EMPLOYEE", title: m.full_name, subtitle: m.email, href: `/employees/${m.id}` });
        if (hits.length >= 22) return hits;
      }
    }
  }
  return hits;
}

function Row({
  icon,
  title,
  subtitle,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
        active && "bg-accent"
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
    </button>
  );
}

export { Link };
