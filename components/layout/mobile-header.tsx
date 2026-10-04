"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import { useNotifications } from "@/components/providers/notifications-provider";
import { cn } from "@/lib/utils";

const TITLES: Array<{ match: (p: string) => boolean; title: string }> = [
  { match: (p) => p === "/", title: "" }, // dashboard renders its own header
  { match: (p) => p.startsWith("/tasks/new"), title: "New task" },
  { match: (p) => p === "/tasks", title: "Tasks" },
  { match: (p) => p.startsWith("/tasks/"), title: "Task" },
  { match: (p) => p === "/projects", title: "Projects" },
  { match: (p) => p.startsWith("/projects/"), title: "Project" },
  { match: (p) => p === "/clients", title: "Clients" },
  { match: (p) => p.startsWith("/clients/"), title: "Client" },
  { match: (p) => p === "/employees", title: "Employees" },
  { match: (p) => p.startsWith("/employees/"), title: "Employee" },
  { match: (p) => p === "/payments", title: "Payments" },
  { match: (p) => p === "/notifications", title: "Notifications" },
  { match: (p) => p === "/settings", title: "Settings" },
  { match: (p) => p === "/profile", title: "Profile" },
  { match: (p) => p === "/calendar", title: "Calendar" },
];

/** Shared hamburger so the drawer opens identically everywhere. */
export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Open navigation menu"
      onClick={onClick}
      className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
    >
      <Menu className="size-5" strokeWidth={1.8} />
    </button>
  );
}

export function MobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  // Detail pages render their own back-navigation header
  const isDetail =
    /^\/(tasks|projects|clients|employees)\/[^/]+$/.test(pathname) ||
    /^\/(tasks|projects|clients|employees)\/[^/]+\/edit$/.test(pathname);
  if (isDetail || pathname === "/dashboard") return null;

  const entry = TITLES.find((t) => t.match(pathname));
  const title = entry?.title || "";

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur lg:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <MenuButton onClick={onMenuClick} />
        {/* Truncates rather than pushing the right-hand icons off-screen
            on a narrow phone. */}
        <h1 className="truncate text-base font-semibold tracking-tight">
          {title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* §1/§21 — mobile search entry point (opens the shared dialog) */}
        <button
          type="button"
          aria-label="Search"
          onClick={() => window.dispatchEvent(new CustomEvent("taskora-open-search"))}
          className="flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
        >
          <Search className="size-5" strokeWidth={1.8} />
        </button>
        <Link
          href="/notifications"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          className="relative flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
        >
          <Bell className="size-5" strokeWidth={1.8} />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground"
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
