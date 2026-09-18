"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TASK_STATUS_DOTS } from "@/lib/constants";
import { isOverdue, cn } from "@/lib/utils";
import type { TaskListItem } from "@/lib/actions/tasks";

/**
 * §8 Calendar / deadline view — a focused month grid of task deadlines.
 * Clicking a task opens the task detail view.
 */
export function CalendarView({ tasks }: { tasks: TaskListItem[] }) {
  const [now] = useState(() => new Date());
  const [month, setMonth] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }));

  const byDay = useMemo(() => {
    const map = new Map<string, TaskListItem[]>();
    for (const t of tasks) {
      if (!t.deadline) continue;
      const key = istDayKey(t.deadline);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks]);

  const grid = useMemo(() => {
    const first = new Date(Date.UTC(month.year, month.month, 1));
    const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
    // Week starts Monday
    const startWeekday = (first.getUTCDay() + 6) % 7;

    const cells: Array<{ day: number; iso: string } | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, iso });
    }
    return cells;
  }, [month]);

  const monthLabel = new Date(Date.UTC(month.year, month.month, 1)).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric", timeZone: "UTC" }
  );

  const todayKey = istDayKey(new Date().toISOString());

  function shift(delta: number) {
    setMonth((m) => {
      const d = new Date(Date.UTC(m.year, m.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setMonth({ year: now.getFullYear(), month: now.getMonth() })}
          >
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-background px-1 py-1.5 text-center font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {grid.map((cell, i) => (
          <div
            key={i}
            className={cn(
              "min-h-16 bg-background p-1 sm:min-h-20",
              cell?.iso === todayKey && "bg-accent/60"
            )}
          >
            {cell && (
              <>
                <p
                  className={cn(
                    "mb-1 px-0.5 text-[10px] text-muted-foreground",
                    cell.iso === todayKey && "font-semibold text-foreground"
                  )}
                >
                  {cell.day}
                </p>
                <div className="space-y-1">
                  {(byDay.get(cell.iso) ?? []).slice(0, 3).map((t) => {
                    const overdue =
                      isOverdue(t.deadline!) && t.status !== "COMPLETED";
                    return (
                      <Link
                        key={t.id}
                        href={`/tasks/${t.id}`}
                        className={cn(
                          "flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight transition-colors hover:bg-accent",
                          overdue && "text-destructive"
                        )}
                        title={t.title}
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            TASK_STATUS_DOTS[t.status]
                          )}
                        />
                        <span className="truncate font-medium">{t.title}</span>
                      </Link>
                    );
                  })}
                  {(byDay.get(cell.iso)?.length ?? 0) > 3 && (
                    <p className="px-1 text-[9px] text-muted-foreground">
                      +{byDay.get(cell.iso)!.length - 3} more
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Convert an ISO instant to the IST calendar day key (YYYY-MM-DD). */
function istDayKey(instant: string): string {
  const d = new Date(instant);
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
