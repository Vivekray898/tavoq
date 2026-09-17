"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import type { ActionResponse, ActivityType } from "@/types/database";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  detail: string | null;
  created_at: string;
  actor_name: string | null;
  actor_avatar: string | null;
  task_id: string | null;
  task_title: string | null;
}

// Human-readable formatting lives in the pure module
// lib/activity-format.ts ("use server" files may only export async actions).

/** Task-scoped activity timeline (§12) */
export async function getTaskActivity(
  taskId: string,
  limit = 20
): Promise<ActionResponse<ActivityItem[]>> {
  try {
    await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("activity")
      .select(
        "id, type, detail, created_at, actor:profiles(id, full_name, avatar_url)"
      )
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[getTaskActivity]", error);
      return { success: false, error: "Failed to load activity" };
    }

    return {
      success: true,
      data: (data ?? []).map(
        (row: {
          id: string;
          type: ActivityType;
          detail: string | null;
          created_at: string;
          actor:
            | { full_name: string; avatar_url: string | null }[]
            | { full_name: string; avatar_url: string | null }
            | null;
        }) => {
          const a = Array.isArray(row.actor) ? row.actor[0] : row.actor;
          return {
            id: row.id,
            type: row.type,
            detail: row.detail,
            created_at: row.created_at,
            actor_name: a?.full_name ?? null,
            actor_avatar: a?.avatar_url ?? null,
            task_id: taskId,
            task_title: null,
          };
        }
      ),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Project-scoped activity (§21) */
export async function getProjectActivity(
  projectId: string,
  limit = 20
): Promise<ActionResponse<ActivityItem[]>> {
  try {
    await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("activity")
      .select(
        "id, type, detail, created_at, task_id, actor:profiles(id, full_name, avatar_url), task:tasks(id, title)"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[getProjectActivity]", error);
      return { success: false, error: "Failed to load activity" };
    }

    return {
      success: true,
      data: (data ?? []).map(
        (row: {
          id: string;
          type: ActivityType;
          detail: string | null;
          created_at: string;
          task_id: string | null;
          actor:
            | { full_name: string; avatar_url: string | null }[]
            | { full_name: string; avatar_url: string | null }
            | null;
          task:
            | { id: string; title: string }[]
            | { id: string; title: string }
            | null;
        }) => {
          const a = Array.isArray(row.actor) ? row.actor[0] : row.actor;
          const t = Array.isArray(row.task) ? row.task[0] : row.task;
          return {
            id: row.id,
            type: row.type,
            detail: row.detail,
            created_at: row.created_at,
            actor_name: a?.full_name ?? null,
            actor_avatar: a?.avatar_url ?? null,
            task_id: row.task_id,
            task_title: t?.title ?? null,
          };
        }
      ),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Admin dashboard: recent agency-wide activity (§26) */
export async function getRecentActivity(
  limit = 8
): Promise<ActionResponse<ActivityItem[]>> {
  try {
    await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("activity")
      .select(
        "id, type, detail, created_at, task_id, actor:profiles(id, full_name, avatar_url), task:tasks(id, title)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[getRecentActivity]", error);
      return { success: false, error: "Failed to load activity" };
    }

    return {
      success: true,
      data: (data ?? []).map(
        (row: {
          id: string;
          type: ActivityType;
          detail: string | null;
          created_at: string;
          task_id: string | null;
          actor:
            | { full_name: string; avatar_url: string | null }[]
            | { full_name: string; avatar_url: string | null }
            | null;
          task:
            | { id: string; title: string }[]
            | { id: string; title: string }
            | null;
        }) => {
          const a = Array.isArray(row.actor) ? row.actor[0] : row.actor;
          const t = Array.isArray(row.task) ? row.task[0] : row.task;
          return {
            id: row.id,
            type: row.type,
            detail: row.detail,
            created_at: row.created_at,
            actor_name: a?.full_name ?? null,
            actor_avatar: a?.avatar_url ?? null,
            task_id: row.task_id,
            task_title: t?.title ?? null,
          };
        }
      ),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}