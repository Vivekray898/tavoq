"use client";

import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  CheckSquare,
  Eye,
  IndianRupee,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/providers/notifications-provider";
import { getRelativeTime, cn } from "@/lib/utils";
import type { NotificationType } from "@/types/database";

const TYPE_ICONS: Record<NotificationType, typeof Bell> = {
  TASK_ASSIGNED: CheckSquare,
  TASK_DUE_SOON: AlertTriangle,
  TASK_OVERDUE: AlertTriangle,
  TASK_SUBMITTED: Eye,
  REVISION_REQUESTED: RotateCcw,
  TASK_APPROVED: CheckSquare,
  PAYMENT_PAID: IndianRupee,
  COMMENT_ADDED: MessageSquare,
  PROJECT_ASSIGNED: CheckSquare,
  ACCOUNT_PENDING: AlertTriangle,
};

/** §69 — every notification routes somewhere useful. */
export function hrefFor(n: {
  reference_type: string | null;
  reference_id: string | null;
}): string {
  if (n.reference_type === "task" && n.reference_id) return `/tasks/${n.reference_id}`;
  if (n.reference_type === "project" && n.reference_id) return `/projects/${n.reference_id}`;
  if (n.reference_type === "payment" && n.reference_id) return "/payments";
  return "/notifications";
}

/**
 * §22 — the topbar bell: unread badge, latest notifications popover,
 * per-item + mark-all read, realtime via the shared provider.
 */
export function NotificationBell() {
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead } =
    useNotifications();

  return (
    <Popover>
      <PopoverTrigger
        className="relative flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
      >
        <Bell className="size-4.5" strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-background">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0 sm:w-[24rem]">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={markAllRead}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
            <BellOff className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">
              Updates about your tasks will show up here.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto overscroll-contain">
            {notifications.slice(0, 10).map((n) => {
              const Icon = TYPE_ICONS[n.type] ?? Bell;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    markRead(n.id);
                    router.push(hrefFor(n));
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-b px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/50",
                    !n.read && "bg-primary/[0.04] dark:bg-primary/[0.06]"
                  )}
                >
                  <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                    {!n.read && (
                      <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-popover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[13px]", !n.read && "font-medium")}>
                      {n.title}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {n.message}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {getRelativeTime(n.created_at)}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => router.push("/notifications")}
              className="w-full border-t px-3.5 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              View all notifications
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
