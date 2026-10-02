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
/**
 * §7 Desktop sidebar navigation — grouped, minimal.
 *
 * SUPER_ADMIN and MANAGER share one nav; the two entries they may not
 * see (/settings, and the employee-only distinction) are filtered in
 * getNavForRole below rather than duplicated here.
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
    items: [{ label: "Team", href: "/employees", icon: Users }],
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

// §24/§25 — employees don't manage projects (project context lives
// inside their tasks); they get their Payments instead.
export const EMPLOYEE_NAV: NavSection[] = [
  { items: [{ label: "Home", href: "/", icon: LayoutDashboard }] },
  {
    items: [
      { label: "My Tasks", href: "/tasks", icon: CheckSquare },
      { label: "Payments", href: "/payments", icon: IndianRupee },
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
  { label: "Payments", href: "/payments", icon: IndianRupee },
  { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
];

/** Secondary destinations inside the admin "More" sheet.
 *  Note: no /search route exists — desktop/mobile search is the
 *  ⌘K SearchDialog in the topbar, so it's intentionally absent here. */
export const ADMIN_MORE_ITEMS: NavItem[] = [
  { label: "Clients", href: "/clients", icon: Building2 },
  { label: "Team", href: "/employees", icon: Users },
  { label: "Payments", href: "/payments", icon: IndianRupee },
  { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Profile", href: "/profile", icon: User },
];

/**
 * Manager "More" items — identical to the super admin's minus
 * /settings, which is super-admin only.
 */
export const MANAGER_MORE_ITEMS: NavItem[] = ADMIN_MORE_ITEMS.filter(
  (item) => item.href !== "/settings"
);

/**
 * Drop any item the given role must not see.
 *
 * Nav hiding is cosmetic: every destination also has a server-side
 * guard on the page itself (requireSuperAdmin / requireStaff), so a
 * user who types the URL directly is redirected rather than shown a
 * blank page.
 */
function filterNav(sections: NavSection[], role: UserRole): NavSection[] {
  const allowSettings = role === "SUPER_ADMIN";
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => allowSettings || item.href !== "/settings"
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/** Employee "More" fallback (only used if notifications not shown) */
export const EMPLOYEE_MORE_ITEMS: NavItem[] = [
  { label: "Profile", href: "/profile", icon: User },
];

/**
 * Navigation for a role.
 *
 *   SUPER_ADMIN → full admin nav, including /settings
 *   MANAGER     → same nav minus /settings
 *   EMPLOYEE    → the personal nav (own tasks, own payments)
 *
 * Phase 1 deliberately gave managers the employee nav, because the
 * server-side guards already allowed them everywhere and the UI simply
 * hadn't caught up. This is that catch-up.
 */
export function getNavForRole(role: UserRole) {
  if (role === "SUPER_ADMIN" || role === "MANAGER") {
    return {
      desktop: filterNav(ADMIN_NAV, role),
      mobile: ADMIN_MOBILE_NAV,
      more: role === "SUPER_ADMIN" ? ADMIN_MORE_ITEMS : MANAGER_MORE_ITEMS,
    };
  }

  return {
    desktop: EMPLOYEE_NAV,
    mobile: EMPLOYEE_MOBILE_NAV,
    more: EMPLOYEE_MORE_ITEMS,
  };
}

export { MoreHorizontal };
