"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { taskActivityOptions, projectActivityOptions } from "@/lib/queries/options";
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
 * Each window size is its own cache entry, so expanding the timeline
 * reads the next cached window instead of refetching from scratch (§3).
 */
export function ActivityTimeline({
  taskId,
  projectId,
  pageSize = 5,
  maxItems = 50,
}: ActivityTimelineProps) {
  const [limit, setLimit] = useState(pageSize);

  const options = taskId
    ? taskActivityOptions(taskId, limit)
    : projectId
      ? projectActivityOptions(projectId, limit)
      : null;

  const { data: items, isLoading, isError } = useQuery(
    options ?? {
      queryKey: ["activity", "none"] as const,
      queryFn: () => Promise.resolve([]),
      enabled: false,
    }
  );

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">Couldn&apos;t load activity.</p>
    );
  }

  if (isLoading || !items) {
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

  const canLoadMore = items.length >= limit && limit < maxItems;

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
            onClick={() => setLimit((l) => Math.min(l + pageSize * 3, maxItems))}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
