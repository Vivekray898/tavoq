import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Building2,
  Users,
  IndianRupee,
  Bell,
  Settings,
  User,
  Search,
  MoreHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserRole } from "@/types/database";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: "notifications";
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * §7 Desktop sidebar navigation — grouped, minimal.
 */
export const ADMIN_NAV: NavSection[] = [
  { items: [{ label: "Overview", href: "/", icon: LayoutDashboard }] },
  {
    title: "Work",
    items: [
      { label: "Tasks", href: "/tasks", icon: CheckSquare },
      { label: "Projects", href: "/projects", icon: FolderKanban },
      { label: "Clients", href: "/clients", icon: Building2 },
    ],
  },
  {
    title: "Team",
    items: [{ label: "Employees", href: "/employees", icon: Users }],
  },
  {
    title: "Finance",
    items: [{ label: "Payments", href: "/payments", icon: IndianRupee }],
  },
  {
    items: [
      { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const EMPLOYEE_NAV: NavSection[] = [
  { items: [{ label: "Home", href: "/", icon: LayoutDashboard }] },
  {
    items: [
      { label: "My Tasks", href: "/tasks", icon: CheckSquare },
      { label: "Projects", href: "/projects", icon: FolderKanban },
    ],
  },
  {
    items: [
      { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
      { label: "Profile", href: "/profile", icon: User },
    ],
  },
];

/**
 * §8 Mobile bottom navigation — max 4 items, secondary actions
 * live in the "More" sheet.
 */
export const ADMIN_MOBILE_NAV: NavItem[] = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Projects", href: "/projects", icon: FolderKanban },
];

export const EMPLOYEE_MOBILE_NAV: NavItem[] = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
];

/** Secondary destinations inside the admin "More" sheet */
export const ADMIN_MORE_ITEMS: NavItem[] = [
  { label: "Search", href: "/search", icon: Search },
  { label: "Clients", href: "/clients", icon: Building2 },
  { label: "Employees", href: "/employees", icon: Users },
  { label: "Payments", href: "/payments", icon: IndianRupee },
  { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Profile", href: "/profile", icon: User },
];

/** Employee "More" fallback (only used if notifications not shown) */
export const EMPLOYEE_MORE_ITEMS: NavItem[] = [
  { label: "Search", href: "/search", icon: Search },
  { label: "Profile", href: "/profile", icon: User },
];

export function getNavForRole(role: UserRole) {
  return {
    desktop: role === "ADMIN" ? ADMIN_NAV : EMPLOYEE_NAV,
    mobile: role === "ADMIN" ? ADMIN_MOBILE_NAV : EMPLOYEE_MOBILE_NAV,
    more: role === "ADMIN" ? ADMIN_MORE_ITEMS : EMPLOYEE_MORE_ITEMS,
  };
}

export { MoreHorizontal };
