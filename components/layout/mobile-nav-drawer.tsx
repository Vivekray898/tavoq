"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { APP_NAME, ROLE_LABELS } from "@/lib/constants";
import { getNavForRole } from "@/lib/navigation";
import { isStaff } from "@/lib/permissions";
import { useNotifications } from "@/components/providers/notifications-provider";
import { useSession } from "@/components/providers/session-provider";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";

/**
 * Mobile navigation drawer — left-anchored, Discord-style.
 *
 * WHY A DRAWER AND NOT A BOTTOM BAR
 * The fixed bottom bar cost permanent vertical space on the smallest
 * screens and could only show four items, so everything else lived behind
 * a "More" sheet — two taps to reach Calendar. The drawer shows every
 * destination at once and occupies no space when closed.
 *
 * FLATTEN, DON'T HIDE. Nothing is collapsible and nothing is nested: a
 * section is a label, not a disclosure. If the list outgrows the viewport
 * the body scrolls and the header stays put.
 *
 * The unread count is read from the SAME NotificationsProvider context the
 * sidebar and header use. No second subscription is opened here — a
 * second Realtime channel for the same table would double the traffic and
 * let the two counts disagree.
 *
 * Body scroll lock and the Escape key are handled by the Sheet primitive
 * (Base UI Dialog), so neither is reimplemented here.
 */
export function MobileNavDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const { role, profile } = useSession();
  const { desktop } = getNavForRole(role);
  // /tasks/new redirects employees back to /tasks, so the button is staff
  // only — the same rule the floating button it replaces enforced.
  const canCreate = isStaff(role);

  // Auto-close on navigation. Tapping a link starts the transition, but a
  // route can also change from elsewhere (a redirect, the back button),
  // and leaving the drawer open over a new page looks broken.
  useEffect(() => {
    if (open) onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className={cn(
          // NOTE the data-[side=left] prefix on the width utilities. The
          // Sheet primitive sets `data-[side=left]:w-3/4`, and a Tailwind
          // variant beats a bare utility on specificity — so plain "w-72"
          // loses and the drawer renders at 75% width. Repeating the
          // variant lets tailwind-merge drop the primitive's width
          // instead of merely appending after it.
          "data-[side=left]:w-72 data-[side=left]:max-w-[85vw]",
          "gap-0 p-0",
          // Clear the notch and the home indicator. The bottom inset goes
          // on the scroll container's padding so the last row is reachable.
          "pb-[env(safe-area-inset-bottom)]"
        )}
      >
        {/* Visually hidden but required for the dialog's accessible name. */}
        <SheetTitle className="sr-only">{APP_NAME} navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Navigate between sections of the app.
        </SheetDescription>

        {/* Sticky header — stays put while the list scrolls. */}
        <div
          className="shrink-0 border-b bg-sidebar px-4 text-sidebar-foreground"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 py-3.5"
            aria-label={`${APP_NAME} home`}
          >
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-sm font-bold leading-none">T</span>
            </div>
            <span className="text-[15px] font-semibold tracking-tight">
              {APP_NAME}
            </span>
          </Link>
        </div>

        {/* Scrolling body. min-h-0 is what lets this shrink and scroll
            instead of pushing the footer off-screen. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* User block — the mobile experience had no way to confirm who
              you are signed in as, which matters on shared tablets. */}
          <div className="border-b bg-sidebar px-3 py-3 text-sidebar-foreground">
            <Link
              href="/profile"
              className="flex items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-sidebar-accent/60"
            >
              <Avatar className="size-8">
                {profile.avatar_url && (
                  <AvatarImage src={profile.avatar_url} alt="" />
                )}
                <AvatarFallback className="text-xs">
                  {getInitials(profile.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile.full_name}
                </p>
                <p className="truncate text-[11px] text-sidebar-foreground/60">
                  {profile.role ? ROLE_LABELS[profile.role] : null}
                </p>
              </div>
            </Link>
          </div>

          {/* Primary action. Replaces the floating button that used to sit
              in the corner of every mobile screen. */}
          {canCreate && (
            <div className="px-3 pt-3">
              <Button
                type="button"
                className="w-full justify-start gap-2"
                render={<Link href="/tasks/new" />}
              >
                <Plus className="size-4" />
                New task
              </Button>
            </div>
          )}

          {/* Every destination the role can reach. Grouping comes straight
              from the desktop sections, so the two surfaces cannot drift
              and a role that filters a whole section loses its label too. */}
          <nav className="flex-1 space-y-5 px-3 py-4">
            {desktop.map((section, i) => (
              <div key={i} className="space-y-0.5">
                {section.title && (
                  <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {section.title}
                  </p>
                )}
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  const showBadge =
                    item.badge === "notifications" && unreadCount > 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => onOpenChange(false)}
                      className={cn(
                        "flex h-10 items-center gap-2.5 rounded-md px-3 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      )}
                    >
                      <item.icon
                        className="size-4 shrink-0"
                        strokeWidth={active ? 2.2 : 2}
                      />
                      {item.label}
                      {showBadge && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Footer — sign out. */}
        <div className="shrink-0 border-t bg-sidebar px-3 py-3 text-sidebar-foreground">
          <SignOutButton />
        </div>
      </SheetContent>
    </Sheet>
  );
}

