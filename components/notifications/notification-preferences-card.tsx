"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  type NotificationPreferencesView,
} from "@/lib/actions/notifications";

/**
 * Phase 2 — per-user notification preferences.
 *
 * Deliberately lives on /notifications rather than /settings: that route is
 * SUPER_ADMIN-only, so a per-user control placed there would be invisible to
 * exactly the employees who need it.
 */
const CHANNELS: {
  key: keyof Omit<NotificationPreferencesView, "push_enabled">;
  label: string;
  description: string;
}[] = [
  { key: "task_assigned", label: "Task assigned", description: "When a task is assigned to you or reassigned away." },
  { key: "status_changed", label: "Status changed", description: "When the status of one of your tasks moves." },
  { key: "review_requested", label: "Review requested", description: "Revisions, submissions, and approvals." },
  { key: "comment_added", label: "Comments", description: "New comments on tasks you follow." },
  { key: "payment_paid", label: "Payments", description: "When a payment is marked paid." },
  { key: "due_reminder", label: "Due reminders", description: "The daily reminder for work due soon." },
];

export function NotificationPreferencesCard() {
  const [prefs, setPrefs] = useState<NotificationPreferencesView | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getMyNotificationPreferences().then((p) => {
      if (!cancelled) setPrefs(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function save(patch: Partial<NotificationPreferencesView>) {
    const previous = prefs;
    // Optimistic: the toggle must respond immediately.
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    startTransition(async () => {
      const res = await updateMyNotificationPreferences(patch);
      if (!res.success) {
        setPrefs(previous);
        toast.error(res.error ?? "Couldn't save your preferences.");
      }
    });
  }

  if (!prefs) {
    return (
      <div className="rounded-xl border bg-card px-4 py-3.5 text-sm text-muted-foreground">
        Loading notification preferences…
      </div>
    );
  }

  const disabled = pending;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">Notification preferences</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Choose what reaches you on this account. In-app notifications are
            always recorded.
          </p>
        </div>
        {pending && <Loader2 className="mt-0.5 size-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="divide-y">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Push notifications</p>
            <p className="text-[13px] text-muted-foreground">
              Master switch. Turning this off silences everything below.
            </p>
          </div>
          <Switch
            checked={prefs.push_enabled}
            disabled={disabled}
            onCheckedChange={(checked) => save({ push_enabled: checked })}
            aria-label="Push notifications"
          />
        </div>

        {CHANNELS.map((c) => (
          <div key={c.key} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm">{c.label}</p>
              <p className="text-[13px] text-muted-foreground">{c.description}</p>
            </div>
            <Switch
              checked={prefs[c.key]}
              // A channel switch is meaningless while the master switch is off.
              disabled={disabled || !prefs.push_enabled}
              onCheckedChange={(checked) => save({ [c.key]: checked })}
              aria-label={c.label}
            />
          </div>
        ))}
      </div>
    </div>
  );
}