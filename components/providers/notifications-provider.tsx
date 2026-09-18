"use client";

import { createContext, useCallback, useContext } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  markNotificationRead,
  markAllMyNotificationsRead,
} from "@/lib/actions/notifications";
import { qk } from "@/lib/queries/keys";
import { notificationsOptions } from "@/lib/queries/options";
import type { Notification } from "@/types/database";

interface NotificationsContextValue {
  unreadCount: number;
  notifications: Notification[];
  isLoading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DEFAULT_VALUE: NotificationsContextValue = {
  unreadCount: 0,
  notifications: [],
  isLoading: false,
  markRead: async () => {},
  markAllRead: async () => {},
  refresh: async () => {},
};

const NotificationsContext = createContext<NotificationsContextValue>(DEFAULT_VALUE);

/**
 * §7 — notification cache lives in the shared query cache; realtime
 * INSERT/UPDATE events are translated by the session RealtimeProvider
 * (INSERT prepends, UPDATE patches `read`), so the unread count is
 * derived directly from the cache. The bell, sidebar, mobile nav and
 * the notifications page can never desync — and none of them refetch
 * on mount.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Seeds the shared cache on first mount (dashboard layout) and serves
  // every consumer from cache afterwards.
  const { data, isLoading } = useQuery(notificationsOptions);

  const notifications: Notification[] = data ?? [];
  const unreadCount = notifications.reduce(
    (count, n) => (n.read ? count : count + 1),
    0
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: qk.notifications() });
  }, [queryClient]);

  const markRead = useCallback(
    async (id: string) => {
      const key = qk.notifications();
      queryClient.setQueryData<Notification[]>(key, (prev) =>
        prev ? prev.map((n) => (n.id === id ? { ...n, read: true } : n)) : prev
      );
      const result = await markNotificationRead(id);
      if (!result.success) {
        // Roll back — never fake success (§24)
        queryClient.setQueryData<Notification[]>(key, (prev) =>
          prev ? prev.map((n) => (n.id === id ? { ...n, read: false } : n)) : prev
        );
      }
    },
    [queryClient]
  );

  const markAllRead = useCallback(async () => {
    const key = qk.notifications();
    const previous = queryClient.getQueryData<Notification[]>(key);
    queryClient.setQueryData<Notification[]>(key, (prev) =>
      prev ? prev.map((n) => ({ ...n, read: true })) : prev
    );

    const result = await markAllMyNotificationsRead();
    if (!result.success) {
      // Roll back to the exact previous rows.
      queryClient.setQueryData<Notification[]>(key, previous);
      toast.error("Couldn't mark notifications as read");
    }
  }, [queryClient]);

  return (
    <NotificationsContext.Provider
      value={{
        unreadCount,
        notifications,
        isLoading,
        markRead,
        markAllRead,
        refresh,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
