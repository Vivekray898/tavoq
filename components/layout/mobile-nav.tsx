"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { getNavForRole } from "@/lib/navigation";
import { useNotifications } from "@/components/providers/notifications-provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";

export function MobileNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const [moreOpen, setMoreOpen] = useState(false);
  const { mobile, more } = getNavForRole(role);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  // Admin gets Home/Tasks/Projects + More; employee gets 4 direct items
  const isAdmin = role === "ADMIN";

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-16 items-stretch justify-around">
          {mobile.map((item) => {
            const active = isActive(item.href);
            const showBadge = item.badge === "notifications" && unreadCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <span className="relative">
                  <item.icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                  {showBadge && (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </span>
                {item.label}
              </Link>
            );
          })}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                moreOpen ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <svg
                className="size-[22px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
              </svg>
              More
            </button>
          )}
        </div>
      </nav>

      {/* More sheet (§31) */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{APP_NAME}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-2 px-4 pb-8">
            {more.map((item) => {
              const showBadge = item.badge === "notifications" && unreadCount > 0;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border p-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <item.icon className="size-5 text-muted-foreground" />
                  {item.label}
                  {showBadge && (
                    <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
