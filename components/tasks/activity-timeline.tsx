"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getTaskActivity, getProjectActivity, type ActivityItem } from "@/lib/actions/activity";
import { formatActivityText } from "@/lib/activity-format";
import { getInitials, getRelativeTime } from "@/lib/utils";

interface ActivityTimelineProps {
  taskId?: string;
  projectId?: string;
  limit?: number;
}

/**
 * §30 — real activity stream (backed by DB triggers, not synthesized).
 */
export function ActivityTimeline({ taskId, projectId, limit }: ActivityTimelineProps) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = taskId
        ? await getTaskActivity(taskId)
        : projectId
          ? await getProjectActivity(projectId, limit ?? 20)
          : { success: false as const };
      if (cancelled) return;
      if (result.success && result.data) {
        setItems(result.data);
      } else {
        setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, projectId, limit]);

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">Couldn&apos;t load activity.</p>
    );
  }

  if (!items) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-7 animate-pulse rounded-full bg-muted" />
            <div className="h-3.5 flex-1 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Activity will appear here as people work on this.
      </p>
    );
  }

  return (
    <div className="space-y-3.5">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5">
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-[10px]">
              {getInitials(item.actor_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-snug text-foreground">
              {formatActivityText(item.actor_name, item.type, item.detail, item.task_title)}
              {item.task_id && item.task_title && (
                <>
                  {" "}
                  <Link
                    href={`/tasks/${item.task_id}`}
                    className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {item.task_title}
                  </Link>
                </>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {getRelativeTime(item.created_at)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
