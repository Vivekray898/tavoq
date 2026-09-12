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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: UserRole;
}

export function MobileSidebar({ open, onOpenChange, role }: MobileSidebarProps) {
  const pathname = usePathname();
  const navItems = role === "ADMIN" ? ADMIN_NAV : EMPLOYEE_NAV;

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b px-4 h-14 flex flex-row items-center">
          <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            T
          </div>
          <SheetTitle className="ml-2 font-semibold">Taskora</SheetTitle>
        </SheetHeader>

        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => {
            const Icon = iconMap[item.icon];
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
