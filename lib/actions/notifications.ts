// lib/actions/notifications.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuth, getUserProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTestPushToUser } from "@/lib/push";
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
      .limit(100);

    if (error) return { success: false, error: "Failed to load notifications" };
    return { success: true, data: (data ?? []) as Notification[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function markNotificationRead(id: string): Promise<ActionResponse> {
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

export async function markAllMyNotificationsRead(): Promise<ActionResponse> {
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

// ────────────────────────────────────────────────────────────
// Phase 2 — push testing and per-user notification preferences.
//
// Appended rather than split into a new module: these are the same
// surface (the caller's own notifications) and keep this file the single
// browser-callable entry point for them.
//
// Every function authorizes through lib/auth and acts on the CALLING user
// only. There is no userId parameter a client could tamper with.
//

/**
 * Send a test push to the caller's own devices.
 *
 * Bypasses the user's preferences and the dedupe log on purpose: the point
 * is to prove their own device is reachable, so honouring "comments off"
 * would defeat the test.
 */
export async function sendTestPush(): Promise<{
  success: boolean;
  devices?: number;
  error?: string;
}> {
  const profile = await getUserProfile();
  if (!profile) {
    return { success: false, error: "You must be signed in." };
  }

  const result = await sendTestPushToUser(profile.id);
  if (!result.sent) {
    return {
      success: false,
      error: result.reason ?? "Couldn't send a test notification.",
    };
  }
  return { success: true, devices: result.devices };
}

export interface NotificationPreferencesView {
  push_enabled: boolean;
  task_assigned: boolean;
  status_changed: boolean;
  review_requested: boolean;
  comment_added: boolean;
  payment_paid: boolean;
  due_reminder: boolean;
}

const ALL_ON: NotificationPreferencesView = {
  push_enabled: true,
  task_assigned: true,
  status_changed: true,
  review_requested: true,
  comment_added: true,
  payment_paid: true,
  due_reminder: true,
};

/**
 * Read the caller's preferences.
 *
 * A missing row means "never configured", which reads as all-on. Defaulting
 * to "off" here would silently opt every existing user out of notifications
 * the first time this ran.
 */
export async function getMyNotificationPreferences(): Promise<NotificationPreferencesView> {
  const profile = await getUserProfile();
  if (!profile) return ALL_ON;

  const admin = createAdminClient();
  const { data } = await admin
    .from("notification_preferences")
    .select("*")
    .eq("user_id", profile.id)
    .maybeSingle();

  return data
    ? { ...ALL_ON, ...(data as NotificationPreferencesView) }
    : ALL_ON;
}

/**
 * Update the caller's preferences.
 *
 * Only whitelisted boolean keys are written, so a crafted payload cannot set
 * `user_id` and overwrite someone else's settings.
 */
export async function updateMyNotificationPreferences(
  patch: Partial<NotificationPreferencesView>
): Promise<{ success: boolean; error?: string }> {
  const profile = await getUserProfile();
  if (!profile) return { success: false, error: "You must be signed in." };

  const allowed: (keyof NotificationPreferencesView)[] = [
    "push_enabled",
    "task_assigned",
    "status_changed",
    "review_requested",
    "comment_added",
    "payment_paid",
    "due_reminder",
  ];

  const clean: Record<string, boolean> = {};
  for (const key of allowed) {
    if (typeof patch[key] === "boolean") clean[key] = patch[key];
  }
  if (Object.keys(clean).length === 0) {
    return { success: false, error: "Nothing to update." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("notification_preferences")
    .upsert({ user_id: profile.id, ...clean, updated_at: new Date().toISOString() });

  if (error) {
    console.error("[updateMyNotificationPreferences]", error);
    return { success: false, error: "Couldn't save your preferences." };
  }
  return { success: true };
}
