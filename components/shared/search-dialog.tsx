"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckSquare, FolderKanban, Building2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { globalSearch, type SearchResult } from "@/lib/actions/dashboard";
import { cn } from "@/lib/utils";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult>({
    tasks: [],
    projects: [],
    clients: [],
  });
  const [loading, setLoading] = useState(false);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results
      setResults({ tasks: [], projects: [], clients: [] });
      return;
    }
     
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await globalSearch(query);
      if (res.success && res.data) setResults(res.data);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  // ⌘K keyboard shortcut (§64)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpenWithFocus();
      }
    }
    function setSearchOpenWithFocus() {
      window.dispatchEvent(new CustomEvent("taskora-open-search"));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Listen for external open events (e.g. from mobile More sheet)
  useEffect(() => {
    function onOpen() {
      onOpenChange(true);
    }
    window.addEventListener("taskora-open-search", onOpen);
    return () => window.removeEventListener("taskora-open-search", onOpen);
  }, [onOpenChange]);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  const hasResults =
    results.tasks.length + results.projects.length + results.clients.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, projects, clients…"
            className="h-11 border-0 bg-transparent shadow-none focus-visible:ring-0"
            autoComplete="off"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {!hasResults && query.trim().length >= 2 && !loading && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matches for “{query}”
            </p>
          )}
          {query.trim().length < 2 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </p>
          )}

          {results.tasks.length > 0 && (
            <Group label="Tasks">
              {results.tasks.map((t) => (
                <Row
                  key={t.id}
                  icon={<CheckSquare className="size-4" />}
                  title={t.title}
                  subtitle={t.project_name ?? undefined}
                  onClick={() => go(`/tasks/${t.id}`)}
                />
              ))}
            </Group>
          )}
          {results.projects.length > 0 && (
            <Group label="Projects">
              {results.projects.map((p) => (
                <Row
                  key={p.id}
                  icon={<FolderKanban className="size-4" />}
                  title={p.name}
                  subtitle={p.client_name ?? undefined}
                  onClick={() => go(`/projects/${p.id}`)}
                />
              ))}
            </Group>
          )}
          {results.clients.length > 0 && (
            <Group label="Clients">
              {results.clients.map((c) => (
                <Row
                  key={c.id}
                  icon={<Building2 className="size-4" />}
                  title={c.name}
                  onClick={() => go(`/clients/${c.id}`)}
                />
              ))}
            </Group>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}

export { Link };
