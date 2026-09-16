"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
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
];

export function MobileHeader() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  // Detail pages render their own back-navigation header
  const isDetail =
    /^\/(tasks|projects|clients|employees)\/[^/]+$/.test(pathname) ||
    /^\/(tasks|projects|clients|employees)\/[^/]+\/edit$/.test(pathname);
  if (isDetail || pathname === "/") return null;

  const entry = TITLES.find((t) => t.match(pathname));
  const title = entry?.title || "";

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-1">
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
