"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  getTaskActivity,
  getProjectActivity,
  type ActivityItem,
} from "@/lib/actions/activity";
import { formatActivityText } from "@/lib/activity-format";
import { getInitials, getRelativeTime } from "@/lib/utils";

interface ActivityTimelineProps {
  taskId?: string;
  projectId?: string;
  /** Items to show initially and per "load more" click. */
  pageSize?: number;
  /** Hard cap on how many items can be loaded. */
  maxItems?: number;
}

/**
 * §30 — real activity stream (backed by DB triggers, not synthesized).
 *
 * Loads `pageSize` items first and reveals more on demand so the
 * section never dominates the task page.
 */
export function ActivityTimeline({
  taskId,
  projectId,
  pageSize = 5,
  maxItems = 50,
}: ActivityTimelineProps) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reset and fetch the first page whenever the scope changes.
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(false);
    (async () => {
      const result = taskId
        ? await getTaskActivity(taskId, pageSize)
        : projectId
          ? await getProjectActivity(projectId, pageSize)
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
  }, [taskId, projectId, pageSize]);

  const loadMore = useCallback(async () => {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    const nextLimit = Math.min(items.length + pageSize, maxItems);
    const result = taskId
      ? await getTaskActivity(taskId, nextLimit)
      : projectId
        ? await getProjectActivity(projectId, nextLimit)
        : { success: false as const };
    if (result.success && result.data) {
      setItems(result.data);
    }
    setLoadingMore(false);
  }, [items, loadingMore, pageSize, maxItems, taskId, projectId]);

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

  const canLoadMore = items.length >= pageSize && items.length < maxItems;

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
              {formatActivityText(
                item.actor_name,
                item.type,
                item.detail,
                item.task_title
              )}
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

      {canLoadMore && (
        <div className="pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {loadingMore ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Loading…
              </>
            ) : (
              "Show more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}