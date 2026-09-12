"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  FolderKanban,
  CheckSquare,
  Users,
  IndianRupee,
  Bell,
  Settings,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { UserRole } from "@/types/database";

const iconMap = {
  LayoutDashboard,
  Building2,
  FolderKanban,
  CheckSquare,
  Users,
  IndianRupee,
  Bell,
  Settings,
  User,
} as const;

interface NavItem {
  label: string;
  href: string;
  icon: keyof typeof iconMap;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { label: "Clients", href: "/clients", icon: "Building2" },
  { label: "Projects", href: "/projects", icon: "FolderKanban" },
  { label: "Tasks", href: "/tasks", icon: "CheckSquare" },
  { label: "Employees", href: "/employees", icon: "Users" },
  { label: "Payments", href: "/payments", icon: "IndianRupee" },
  { label: "Notifications", href: "/notifications", icon: "Bell" },
  { label: "Settings", href: "/settings", icon: "Settings" },
];

const EMPLOYEE_NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { label: "My Tasks", href: "/tasks", icon: "CheckSquare" },
  { label: "Projects", href: "/projects", icon: "FolderKanban" },
  { label: "Notifications", href: "/notifications", icon: "Bell" },
  { label: "Profile", href: "/profile", icon: "User" },
];

interface SidebarProps {
  role: UserRole;
  unreadCount?: number;
}

export function Sidebar({ role, unreadCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const navItems = role === "ADMIN" ? ADMIN_NAV : EMPLOYEE_NAV;

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:border-r bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b">
        <Link href="/" className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            T
          </div>
          <span className="font-semibold text-lg tracking-tight">Taskora</span>
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = iconMap[item.icon];
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
                {item.icon === "Bell" && unreadCount > 0 && (
                  <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-3">
        <p className="text-[11px] text-muted-foreground text-center">
          Taskora v1.0
        </p>
      </div>
    </aside>
  );
}
