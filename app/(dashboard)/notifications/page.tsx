"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  CheckSquare,
  Eye,
  RotateCcw,
  IndianRupee,
  MessageSquare,
  FolderKanban,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonCard } from "@/components/shared/skeleton-loader";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "@/lib/actions/notifications";
import { getRelativeTime, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Notification, NotificationType } from "@/types/database";

const typeIcons: Record<NotificationType, typeof Bell> = {
  TASK_ASSIGNED: CheckSquare,
  TASK_DUE_SOON: Clock,
  TASK_OVERDUE: AlertTriangle,
  TASK_SUBMITTED: Eye,
  REVISION_REQUESTED: RotateCcw,
  TASK_APPROVED: CheckSquare,
  PAYMENT_PAID: IndianRupee,
  COMMENT_ADDED: MessageSquare,
  PROJECT_ASSIGNED: FolderKanban,
};

const typeLinks: Record<NotificationType, (refId: string | null) => string> = {
  TASK_ASSIGNED: (id) => (id ? `/tasks/${id}` : "/tasks"),
  TASK_DUE_SOON: (id) => (id ? `/tasks/${id}` : "/tasks"),
  TASK_OVERDUE: (id) => (id ? `/tasks/${id}` : "/tasks"),
  TASK_SUBMITTED: (id) => (id ? `/tasks/${id}` : "/tasks"),
  REVISION_REQUESTED: (id) => (id ? `/tasks/${id}` : "/tasks"),
  TASK_APPROVED: (id) => (id ? `/tasks/${id}` : "/tasks"),
  PAYMENT_PAID: (id) => (id ? `/tasks/${id}` : "/tasks"),
  COMMENT_ADDED: (id) => (id ? `/tasks/${id}` : "/tasks"),
  PROJECT_ASSIGNED: (id) => (id ? `/projects/${id}` : "/projects"),
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await getNotifications();
      if (result.success && result.data) {
        setNotifications(result.data);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleMarkRead(id: string) {
    await markAsRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }

  async function handleMarkAllRead() {
    await markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("All notifications marked as read");
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
              <CheckCheck className="size-4" />
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          title="No notifications"
          description="You're all caught up!"
          icon={<Bell className="size-8 text-muted-foreground" />}
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const Icon = typeIcons[notification.type] || Bell;
            const link =
              typeLinks[notification.type]?.(notification.reference_id) || "#";

            return (
              <Link key={notification.id} href={link}>
                <Card
                  className={cn(
                    "hover:shadow-sm transition-shadow cursor-pointer",
                    !notification.read && "bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
                  )}
                  onClick={() => {
                    if (!notification.read) handleMarkRead(notification.id);
                  }}
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-muted shrink-0">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{notification.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {notification.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {getRelativeTime(notification.created_at)}
                      </p>
                    </div>
                    {!notification.read && (
                      <div className="size-2 rounded-full bg-blue-500 shrink-0 mt-2" />
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
