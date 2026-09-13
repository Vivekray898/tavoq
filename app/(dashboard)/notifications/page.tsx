"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { createClient } from "@/lib/supabase/client";
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
  const [live, setLive] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const result = await getNotifications();
      if (result.success && result.data) {
        setNotifications(result.data);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Load current user + first page of notifications
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserId(user.id);

      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // Realtime subscription — only for this user's notifications
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`notifications-page-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refresh();
        }
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  async function handleMarkRead(id: string) {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    const result = await markAsRead(id);
    if (!result.success) {
      // Roll back on failure
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: false } : n))
      );
    }
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    const result = await markAllAsRead();
    if (result.success) {
      toast.success("All notifications marked as read");
    } else {
      toast.error(result.error ?? "Failed to mark all as read");
      refresh();
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "inline-block size-2 rounded-full",
                  live ? "bg-green-500 animate-pulse" : "bg-gray-400"
                )}
              />
              {live ? "Live" : "Connecting…"}
            </div>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
                <CheckCheck className="size-4" />
                Mark all read
              </Button>
            )}
          </div>
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
                    !notification.read &&
                      "bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
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