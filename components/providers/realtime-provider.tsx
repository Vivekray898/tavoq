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
    const authUserId = userId;

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

    /**
     * Comment-author resolution cache (§2 — no N+1). Known authors come
     * from cached task details / the team list; genuinely unknown authors
     * are batch-fetched with one `.in("id", ids)` read and remembered for
     * the session. Ten comments from five users = zero to one query.
     */
    const authorCache = new Map<
      string,
      { id: string; full_name: string; avatar_url: string | null }
    >();
    let authorsInFlight: Promise<void> | null = null;

    const seedAuthorsFromCaches = () => {
      queryClient
        .getQueriesData<TaskDetail>({ queryKey: ["tasks", "detail"] })
        .forEach(([, detail]) => {
          detail?.comments.forEach((c) => {
            if (c.user && !authorCache.has(c.user_id)) {
              authorCache.set(c.user_id, c.user);
            }
          });
        });
      const team = queryClient.getQueryData<{ id: string; full_name: string; avatar_url: string | null }[]>(
        qk.employeesList()
      );
      team?.forEach((m) => {
        if (!authorCache.has(m.id)) authorCache.set(m.id, { id: m.id, full_name: m.full_name, avatar_url: m.avatar_url });
      });
      const active = queryClient.getQueryData<
        { id: string; full_name: string; avatar_url: string | null }[]
      >(qk.activeEmployees());
      active?.forEach((m) => {
        if (!authorCache.has(m.id)) authorCache.set(m.id, { id: m.id, full_name: m.full_name, avatar_url: m.avatar_url });
      });
    };

    const fetchMissingAuthors = (missing: string[]) => {
      if (missing.length === 0) return Promise.resolve();
      if (!authorsInFlight) {
        authorsInFlight = (async () => {
          try {
            const { data } = await supabase
              .from("profiles")
              .select("id, full_name, avatar_url")
              .in("id", missing);
            (data ?? []).forEach((p) => authorCache.set(p.id, p));
          } catch {
            /* fall through to placeholder resolution */
          } finally {
            authorsInFlight = null;
          }
        })();
      }
      return authorsInFlight;
    };

    const resolveAuthor = (userId: string) =>
      authorCache.get(userId) ?? {
        id: userId,
        full_name: "Unknown",
        avatar_url: null,
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

      seedAuthorsFromCaches();
      const knownAuthor = authorCache.get(row.user_id);
      if (!knownAuthor) {
        // One batched read for all currently-missing authors, shared
        // across concurrent comment events.
        await fetchMissingAuthors([row.user_id]);
      }

      queryClient.setQueryData<TaskDetail>(detailKey, (prev) =>
        prev
          ? {
              ...prev,
              comments: [...prev.comments, { ...row, user: resolveAuthor(row.user_id) }].sort(
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

    /**
     * §4 Dashboard: task/comment/payment events sync the dashboard
     * metrics ONLY while it's currently mounted; if unmounted, nothing
     * runs (no background fetches — it serves fresh cache on next visit).
     * A short debounce also collapses bursts of events into one sync.
     */
    let dashboardTimer: ReturnType<typeof setTimeout> | null = null;
    const syncDashboard = () => {
      const mounted = queryClient.getQueryData(["dashboard", "admin"]) || queryClient.getQueryData(["dashboard", "employee"]);
      if (!mounted) return; // dashboard not on screen → do nothing
      if (dashboardTimer) clearTimeout(dashboardTimer);
      dashboardTimer = setTimeout(() => {
        dashboardTimer = null;
        queryClient.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" });
      }, 400);
    };

    /**
     * §7 project_members — a manager added to (or removed from) a project
     * must see the project list update without a refresh. This also covers
     * their own membership changing mid-session.
     */
    const patchProjectMembers = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown> | undefined;
      old: Record<string, unknown> | undefined;
    }) => {
      const row = payload.new ?? payload.old;
      const userId = row?.user_id as string | undefined;
      if (userId && userId !== authUserId) {
        // Someone else's membership doesn't change what this user can see.
        return;
      }

      // The projects list is server-scoped, and a membership row carries no
      // project name, so the list is refetched — but ONLY while it is on
      // screen (refetchType: "active"). An unmounted list costs nothing.
      queryClient.invalidateQueries({
        queryKey: ["projects"],
        refetchType: "active",
      });
      // A new membership can add projects to the task-create picker.
      queryClient.invalidateQueries({
        queryKey: qk.projectsForTask(),
        refetchType: "active",
      });
    };

    /**
     * §7 project_resources — the project detail screen embeds resources, and
     * the resource rows are self-contained enough to patch in place.
     */
    const patchProjectResources = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown> | undefined;
      old: Record<string, unknown> | undefined;
    }) => {
      const row = (payload.new ?? payload.old) as
        | { id?: string; project_id?: string }
        | undefined;
      const projectId = row?.project_id as string | undefined;
      if (!projectId) return;

      // Resources are embedded on the project detail cache.
      const detailKey = qk.projectDetail(projectId);
      const cached = queryClient.getQueryData(detailKey) as
        | { resources?: unknown[] }
        | undefined;
      if (!cached) return;

      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: string })?.id;
        if (!id) return;
        queryClient.setQueryData(detailKey, (prev) =>
          prev && Array.isArray((prev as { resources?: unknown[] }).resources)
            ? {
                ...prev,
                resources: (prev as { resources: unknown[] }).resources.filter(
                  (r) => (r as { id?: string }).id !== id
                ),
              }
            : prev
        );
        return;
      }

      const id = (payload.new as { id?: string })?.id;
      if (!id) return;
      queryClient.setQueryData(detailKey, (prev) => {
        if (!prev) return prev;
        const resources = Array.isArray((prev as { resources?: unknown[] }).resources)
          ? ([...(prev as { resources: unknown[] }).resources])
          : [];
        const at = resources.findIndex((r) => (r as { id?: string }).id === id);
        if (at === -1) resources.push(payload.new);
        else resources[at] = { ...(resources[at] as object), ...payload.new };
        return { ...prev, resources };
      });
    };

    /**
     * §7 task_subtasks — subtasks live inside the task detail cache, so a
     * change patches that document rather than triggering a refetch.
     */
    const patchSubtask = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown> | undefined;
      old: Record<string, unknown> | undefined;
    }) => {
      const row = (payload.new ?? payload.old) as
        | { id?: string; task_id?: string; done?: boolean }
        | undefined;
      const taskId = row?.task_id as string | undefined;
      if (!taskId) return;

      const detailKey = qk.taskDetail(taskId);
      const cached = queryClient.getQueryData<TaskDetail>(detailKey);
      if (!cached?.subtasks) return;

      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: string })?.id;
        if (!id) return;
        queryClient.setQueryData<TaskDetail>(detailKey, (prev) => {
          if (!prev?.subtasks) return prev;
          const remaining = prev.subtasks.filter((s) => s.id !== id);
          return {
            ...prev,
            subtasks: remaining,
            subtasks_done: remaining.filter((s) => s.done).length,
          };
        });
        return;
      }

      const id = (payload.new as { id?: string })?.id;
      if (!id) return;
      queryClient.setQueryData<TaskDetail>(detailKey, (prev) => {
        if (!prev?.subtasks) return prev;
        const at = prev.subtasks.findIndex((s) => s.id === id);
        const next =
          at === -1
            ? [...prev.subtasks, payload.new as TaskDetail["subtasks"][number]]
            : prev.subtasks.map((s, i) =>
                i === at ? ({ ...s, ...payload.new } as typeof s) : s
              );
        return {
          ...prev,
          subtasks: next,
          subtasks_done: next.filter((s) => s.done).length,
        };
      });
    };

    /**
     * §7 activity — activity rows are self-contained (type, detail,
     * created_at, actor), so they can be prepended into whichever
     * activity caches are mounted. Counts are not aggregated here, so no
     * dashboard invalidation is needed.
     */
    const patchActivity = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown> | undefined;
      old: Record<string, unknown> | undefined;
    }) => {
      if (payload.eventType === "DELETE") return; // no visible effect

      const row = payload.new as
        | { id?: string; task_id?: string | null; project_id?: string | null }
        | undefined;
      if (!row?.id) return;

      // setQueriesData's updater does not receive the query, so the
      // scope filter is applied by walking the matched caches
      // explicitly rather than guessing from a single list.
      const caches = queryClient.getQueriesData<unknown[]>({
        queryKey: ["activity"],
      });
      for (const [queryKey, list] of caches) {
        if (!Array.isArray(list)) continue;
        const scopeTaskId =
          queryKey[1] === "task" ? (queryKey[2] as string) : null;
        const scopeProjectId =
          queryKey[1] === "project" ? (queryKey[2] as string) : null;

        // Only feed an activity cache whose scope this row belongs to.
        if (scopeTaskId && row.task_id !== scopeTaskId) continue;
        if (scopeProjectId && row.project_id !== scopeProjectId) continue;
        if (list.some((a) => (a as { id?: string }).id === row.id)) continue;

        // Feed order is newest-first, matching the queries.
        queryClient.setQueryData(queryKey, [row, ...list]);
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
          syncDashboard();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload) => {
          patchCachedTask(payload.new as Record<string, unknown>);
          syncDashboard();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "tasks" },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (!id) return;
          // Scrub from every task-shaped cache (§2).
          queryClient.setQueriesData<TaskListItem[]>({ queryKey: qk.tasks() }, (list) =>
            Array.isArray(list) ? list.filter((t) => t.id !== id) : list
          );
          queryClient.removeQueries({ queryKey: qk.taskDetail(id) });
          syncDashboard();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_comments" },
        (payload) => {
          void appendComment(payload.new as never);
          // A new comment changes comments_count on the task → mounted
          // dashboards that aggregate it sync. Unmounted: nothing runs.
          syncDashboard();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        () => {
          // Task rows are updated alongside payments, so the tasks UPDATE
          // event keeps task caches fresh. Sync payment queries + mounted
          // dashboard metrics only.
          queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
          syncDashboard();
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
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | Record<string, unknown>
            | undefined;
          const id = row?.id as string | undefined;
          if (!id) return;

          if (payload.eventType === "DELETE") {
            queryClient.setQueriesData<{ id: string }[]>(
              { queryKey: qk.employeesList() },
              (list) =>
                Array.isArray(list) ? list.filter((m) => m.id !== id) : list
            );
            queryClient.setQueriesData<{ id: string }[]>(
              { queryKey: qk.activeEmployees() },
              (list) =>
                Array.isArray(list) ? list.filter((m) => m.id !== id) : list
            );
            return;
          }

          // An approval is a status/role change on a row the employees
          // screen already lists. Patch it in place so the badge flips
          // live instead of round-tripping through a refetch.
          queryClient.setQueriesData<{ id: string }[]>(
            { queryKey: qk.employeesList() },
            (list) => {
              if (!Array.isArray(list)) return list;
              const at = list.findIndex((m) => m.id === id);
              if (at === -1) return list;
              const next = [...list];
              next[at] = { ...next[at], ...row };
              return next;
            }
          );
          queryClient.setQueriesData<{ id: string }[]>(
            { queryKey: qk.activeEmployees() },
            (list) => {
              if (!Array.isArray(list)) return list;
              const at = list.findIndex((m) => m.id === id);
              if (at === -1) return list;
              const next = [...list];
              next[at] = { ...next[at], ...row };
              return next;
            }
          );

          // The detail page renders fields the list cache does not carry
          // (email, phone), so it is marked stale rather than patched.
          queryClient.invalidateQueries({
            queryKey: qk.employeeDetail(id),
            refetchType: "none",
          });

          // A role change alters what the signed-in user may see.
          if (id === authUserId) syncDashboard();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_members" },
        patchProjectMembers
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_resources" },
        patchProjectResources
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_subtasks" },
        patchSubtask
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity" },
        patchActivity
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
