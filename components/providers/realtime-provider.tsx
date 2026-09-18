"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import type { TaskListItem, TaskDetail } from "@/lib/actions/tasks";
import type { Notification } from "@/types/database";

/**
 * §5/§6 — database events → targeted cache updates.
 *
 * One subscription set per authenticated session (mounted once in the
 * dashboard layout), replacing the eight per-component channels that each
 * refetched everything on any event. Each event writes only the affected
 * resource's cache; queries that aren't mounted never run.
 */
export function RealtimeProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    let everConnected = false;

    /** Merge raw task columns onto cached task objects, preserving embeds. */
    const patchCachedTask = (row: Record<string, unknown>) => {
      const id = row.id as string | undefined;
      if (!id) return;
      queryClient.setQueriesData<TaskListItem[]>({ queryKey: qk.tasks() }, (list) => {
        if (!Array.isArray(list)) return list;
        if (!list.some((t) => t.id === id)) return list;
        return list.map((t) => (t.id === id ? { ...t, ...row } : t));
      });
      const detailKey = qk.taskDetail(id);
      if (queryClient.getQueryData(detailKey)) {
        queryClient.setQueryData<TaskDetail>(detailKey, (prev) =>
          prev ? ({ ...prev, ...row } as TaskDetail) : prev
        );
      }
    };

    /** task_comments INSERT → append to the open task's detail cache only (§6). */
    const appendComment = async (row: {
      id: string;
      task_id: string;
      user_id: string;
      comment: string;
      created_at: string;
    }) => {
      const detailKey = qk.taskDetail(row.task_id);
      const cached = queryClient.getQueryData<TaskDetail>(detailKey);
      if (!cached) return; // task not open → nothing to update
      if (cached.comments.some((c) => c.id === row.id)) return;

      let author =
        cached.comments.find((c) => c.user_id === row.user_id)?.user ?? null;
      if (!author) {
        // One tiny profile read only when we truly don't know the author.
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .eq("id", row.user_id)
          .maybeSingle();
        author = data ?? { id: row.user_id, full_name: "Unknown", avatar_url: null };
      }

      queryClient.setQueryData<TaskDetail>(detailKey, (prev) =>
        prev
          ? {
              ...prev,
              comments: [...prev.comments, { ...row, user: author }].sort(
                (a, b) =>
                  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              ),
              comments_count: prev.comments_count + 1,
            }
          : prev
      );
    };

    /** notifications INSERT → prepend + toast (§7). The unread count is
     * derived downstream from these cached rows. */
    const handleNotificationInsert = (notification: Notification) => {
      queryClient.setQueryData<Notification[]>(qk.notifications(), (prev) => {
        if (!prev) return [notification]; // cache cold → seed with the new row
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev].slice(0, 100);
      });
      const showTitles = new Set([
        "New task assigned",
        "Task submitted",
        "Revision requested",
        "Payment received",
      ]);
      if (showTitles.has(notification.title)) {
        toast(notification.title, { description: notification.message });
      }
    };

    const channel = supabase
      .channel("taskora-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks" },
        () => {
          // The realtime payload has no embed fields (project_name,
          // labels…), so patching list items isn't safe. Refetch only the
          // mounted ['tasks'] list; nothing else runs.
          queryClient.invalidateQueries({ queryKey: qk.tasks(), refetchType: "active" });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload) => patchCachedTask(payload.new as Record<string, unknown>)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "tasks" },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (!id) return;
          queryClient.setQueriesData<TaskListItem[]>({ queryKey: qk.tasks() }, (list) =>
            Array.isArray(list) ? list.filter((t) => t.id !== id) : list
          );
          queryClient.removeQueries({ queryKey: qk.taskDetail(id) });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_comments" },
        (payload) => void appendComment(payload.new as never)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        () => {
          // Task rows are updated alongside payments, so the tasks UPDATE
          // event keeps task caches fresh. Here only payment queries sync.
          queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string }).id;
            if (id) queryClient.removeQueries({ queryKey: qk.projectDetail(id) });
          } else {
            const row = payload.new as Record<string, unknown>;
            const id = row.id as string | undefined;
            if (id && queryClient.getQueryData(qk.projectDetail(id))) {
              queryClient.setQueryData(qk.projectDetail(id), (prev: object | undefined) =>
                prev ? { ...prev, ...row } : prev
              );
            }
          }
          // Archive/restore flips membership between the two cached tabs.
          queryClient.invalidateQueries({
            queryKey: ["projects", "list"],
            refetchType: "active",
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clients" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string }).id;
            if (id) queryClient.removeQueries({ queryKey: qk.clientDetail(id) });
          } else {
            const row = payload.new as Record<string, unknown>;
            const id = row.id as string | undefined;
            if (id && queryClient.getQueryData(qk.clientDetail(id))) {
              queryClient.setQueryData(qk.clientDetail(id), (prev: object | undefined) =>
                prev ? { ...prev, ...row } : prev
              );
            }
          }
          queryClient.invalidateQueries({
            queryKey: ["clients", "list"],
            refetchType: "active",
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          queryClient.invalidateQueries({
            queryKey: qk.employeesList(),
            refetchType: "active",
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => handleNotificationInsert(payload.new as Notification)
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
          queryClient.setQueryData<Notification[]>(qk.notifications(), (prev) =>
            prev ? prev.map((n) => (n.id === updated.id ? updated : n)) : prev
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && everConnected) {
          // Reconnect after a drop → targeted synchronization of only the
          // on-screen queries; never a full-application reload (§18).
          queryClient.invalidateQueries({ refetchType: "active" });
        }
        if (status === "SUBSCRIBED") everConnected = true;
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  return <>{children}</>;
}
