"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  markNotificationRead,
  markAllMyNotificationsRead,
} from "@/lib/actions/notifications";
import type { Notification } from "@/types/database";

interface NotificationsContextValue {
  unreadCount: number;
  notifications: Notification[];
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  notifications: [],
  markRead: async () => {},
  markAllRead: async () => {},
  refresh: async () => {},
});

interface NotificationsProviderProps {
  userId: string;
  children: React.ReactNode;
}

/**
 * One subscription for the whole app, scoped to the current user's
 * notification rows. Feeds the topbar badge, mobile nav badge and the
 * notifications page — so they can never desync (§15, §17, §45, §46).
 */
export function NotificationsProvider({
  userId,
  children,
}: NotificationsProviderProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient();
      const [{ data: rows }, { count }] = await Promise.all([
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("read", false),
      ]);
      if (rows) setNotifications(rows as Notification[]);
      setUnreadCount(count ?? 0);
    } catch (err) {
      console.error("[NotificationsProvider] refresh failed:", err);
    }
  }, [userId]);

  // Initial load
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    refresh();
  }, [refresh]);

  // Realtime: single scoped channel, cleaned up on unmount (§46)
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const notification = payload.new as Notification;
          setNotifications((prev) => [notification, ...prev].slice(0, 50));
          setUnreadCount((prev) => prev + 1);

          // In-app toast for important events (§15)
          const showTitles = new Set([
            "New task assigned",
            "Task submitted",
            "Revision requested",
            "Payment received",
          ]);
          if (showTitles.has(notification.title)) {
            toast(notification.title, {
              description: notification.message,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as Notification;
          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n))
          );
          if (updated.read) {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic (§38)
    let wasUnread = false;
    setNotifications((prev) =>
      prev.map((n) => {
        if (n.id === id && !n.read) {
          wasUnread = true;
          return { ...n, read: true };
        }
        return n;
      })
    );
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));

    const result = await markNotificationRead(id);
    if (!result.success) {
      // Roll back
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: false } : n))
      );
      setUnreadCount((prev) => prev + 1);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const previous = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    const result = await markAllMyNotificationsRead();
    if (!result.success) {
      setNotifications(previous);
      const unread = previous.filter((n) => !n.read).length;
      setUnreadCount(unread);
      toast.error("Couldn't mark notifications as read");
    }
  }, [notifications]);

  return (
    <NotificationsContext.Provider
      value={{ unreadCount, notifications, markRead, markAllRead, refresh }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
