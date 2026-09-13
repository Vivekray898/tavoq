// lib/actions/notifications.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import type { ActionResponse, Notification } from "@/types/database";

export async function getNotifications(): Promise<ActionResponse<Notification[]>> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return { success: false, error: "Failed to load notifications" };
    return { success: true, data: (data ?? []) as Notification[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function markAsRead(id: string): Promise<ActionResponse> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", id)
      .eq("user_id", profile.id); // safety: only own notifications

    if (error) return { success: false, error: "Failed to mark as read" };
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function markAllAsRead(): Promise<ActionResponse> {
  try {
    const profile = await requireAuth();
    const supabase = await createClient();

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", profile.id)
      .eq("read", false);

    if (error) return { success: false, error: "Failed to mark all as read" };
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}