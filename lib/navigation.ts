import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Building2,
  Users,
  IndianRupee,
  Bell,
  CalendarDays,
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
  /**
   * Which roles may see this item.
   *
   * Single source of truth for the whole app: the desktop sidebar, the
   * mobile drawer and the tests all derive from this, so a role rule can
   * never be enforced in one surface and forgotten in the other.
   *
   * Omitted means "every role" — see ALL_ROLES below.
   */
  roles?: UserRole[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const ALL_ROLES: UserRole[] = ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"];

/** Roles that reach staff-only surfaces (admin nav). */
export const STAFF_ROLES: UserRole[] = ["SUPER_ADMIN", "MANAGER"];

// ──────────────────────────────────────────────
// The role matrix, declared once.
//
//    item                    SUPER_ADMIN  MANAGER  EMPLOYEE
//    Overview (/)                  ✅        ✅        ✅
//    Tasks (/tasks)                ✅        ✅        ✅
//    Calendar (/calendar)          ✅        ✅        ✅
//    Projects (/projects)          ✅        ✅        ❌
//    Clients (/clients)            ✅        ✅        ❌
//    Team (/employees)             ✅        ✅        ❌
//    Payments (/payments)          ✅        ✅        ✅  (own rows)
//    Notifications                 ✅        ✅        ✅
//    Settings (/settings)          ✅        ❌        ❌
//
// Two deliberate deviations from a literal reading of that table, both
// because the SERVER already behaves this way and hiding a working
// destination is worse than the matrix suggesting:
//
//   • Payments is visible to EMPLOYEE. They get their own earnings view
//     (EmployeePaymentsView), RLS grants "Active employees can read own
//     task payments", and /payments already branches on role. Removing
//     the entry would strand a page that works.
//   • Calendar is visible to all three roles, deliberately: an employee
//     syncing their own deadlines is the entire point of the page.
//
// Nav hiding is cosmetic. Every destination also has a server-side guard
// on the page itself (requireStaff / requireSuperAdmin / role branch),
// so typing a URL directly is redirected rather than shown a blank page.
// ──────────────────────────────────────────────

/** Every destination in the app, in drawer order. */
const ALL_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Projects", href: "/projects", icon: FolderKanban, roles: STAFF_ROLES },
  { label: "Clients", href: "/clients", icon: Building2, roles: STAFF_ROLES },
  { label: "Team", href: "/employees", icon: Users, roles: STAFF_ROLES },
  { label: "Payments", href: "/payments", icon: IndianRupee },
  {
    label: "Notifications",
    href: "/notifications",
    icon: Bell,
    badge: "notifications",
  },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["SUPER_ADMIN"] },
];

/** Sections for a role, preserving ALL_ITEMS order within each. */
function sectionsFor(items: NavItem[]): NavSection[] {
  const sections: NavSection[] = [
    { items: items.filter((i) => i.href === "/") },
    {
      title: "Work",
      items: items.filter((i) =>
        ["/tasks", "/calendar", "/projects", "/clients"].includes(i.href)
      ),
    },
    { title: "Team", items: items.filter((i) => i.href === "/employees") },
    { title: "Finance", items: items.filter((i) => i.href === "/payments") },
    {
      items: items.filter((i) => ["/notifications", "/settings"].includes(i.href)),
    },
  ];
  // Never emit an empty section — an employee has no Team section.
  return sections.filter((s) => s.items.length > 0);
}

/** Items the given role may see, in canonical order. */
export function getNavItemsForRole(role: UserRole): NavItem[] {
  return ALL_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

/**
 * Navigation for a role.
 *
 *   SUPER_ADMIN → full nav, including /settings
 *   MANAGER     → same nav minus /settings
 *   EMPLOYEE    → personal nav (own tasks, own calendar, own payments)
 *
 * `desktop` keeps the existing grouped shape the sidebar renders.
 * `mobile` is the flattened, un-grouped list the drawer renders — same
 * items, one tap away, nothing collapsible.
 */
export function getNavForRole(role: UserRole) {
  const items = getNavItemsForRole(role);
  const sections = sectionsFor(items);

  // §24/§25 — employees also get a Profile row, which is their identity
  // surface (the drawer renders it in the user block as well).
  const employeeProfile: NavItem[] =
    role === "EMPLOYEE"
      ? [{ label: "Profile", href: "/profile", icon: User }]
      : [];

  return {
    desktop: sections,
    mobile: [...items, ...employeeProfile],
    more: employeeProfile,
  };
}

export { MoreHorizontal };
export { ALL_ITEMS };