"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckSquare,
  Eye,
  IndianRupee,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
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
};

function hrefFor(n: { reference_type: string | null; reference_id: string | null }): string {
  if (n.reference_type === "task" && n.reference_id) return `/tasks/${n.reference_id}`;
  if (n.reference_type === "project" && n.reference_id) return `/projects/${n.reference_id}`;
  return "/notifications";
}

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    refresh,
  } = useNotifications();

  // Silent refresh when the page mounts so anything created on the
  // server (e.g. while the tab was closed) shows up immediately
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Group by Today / Yesterday / Earlier (§16)
  const groups: Array<{ label: string; items: typeof notifications }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const todayItems = notifications.filter((n) => new Date(n.created_at) >= today);
  const yesterdayItems = notifications.filter(
    (n) => new Date(n.created_at) >= yesterday && new Date(n.created_at) < today
  );
  const earlierItems = notifications.filter((n) => new Date(n.created_at) < yesterday);

  if (todayItems.length) groups.push({ label: "Today", items: todayItems });
  if (yesterdayItems.length) groups.push({ label: "Yesterday", items: yesterdayItems });
  if (earlierItems.length) groups.push({ label: "Earlier", items: earlierItems });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {unreadCount} unread
            </span>
          )}
        </h1>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="Updates about your tasks and payments will show up here."
          icon={<Bell />}
        />
      ) : (
        groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </h2>
            <div className="divide-y rounded-xl border bg-card">
              {group.items.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Bell;
                return (
                  <Link
                    key={n.id}
                    href={hrefFor(n)}
                    onClick={() => markRead(n.id)}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50",
                      !n.read && "bg-primary/[0.04] dark:bg-primary/[0.06]"
                    )}
                  >
                    <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                      {!n.read && (
                        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", n.read ? "text-foreground" : "font-medium text-foreground")}>
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">
                        {n.message}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {getRelativeTime(n.created_at)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
