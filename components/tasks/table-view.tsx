"use client";

import Link from "next/link";
import { Paperclip, MessageSquare } from "lucide-react";
import { StatusDot } from "@/components/shared/status-dot";
import { TASK_STATUS_LABELS, PRIORITY_LABELS, LABEL_CHIP } from "@/lib/constants";
import { formatDeadline, isOverdue, cn } from "@/lib/utils";
import type { TaskListItem } from "@/lib/actions/tasks";

const ALL_COLUMNS = [
  { key: "title", label: "Task" },
  { key: "project", label: "Project" },
  { key: "assignee", label: "Assignee" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "due", label: "Due" },
] as const;

type ColumnKey = (typeof ALL_COLUMNS)[number]["key"];

/**
 * §9 Table view — compact, admin-oriented; column visibility toggle.
 * Not the default view — list stays friendlier.
 */
export function TableView({ tasks }: { tasks: TaskListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            {ALL_COLUMNS.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue =
              !!t.deadline && isOverdue(t.deadline) && t.status !== "COMPLETED";
            return (
              <tr
                key={t.id}
                className="border-b transition-colors last:border-0 hover:bg-accent/40"
              >
                <td className="max-w-64 px-3 py-2.5">
                  <Link href={`/tasks/${t.id}`} className="block">
                    <p className="truncate font-medium hover:underline">{t.title}</p>
                    {t.labels.length > 0 && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {t.labels.slice(0, 3).map((l) => (
                          <span
                            key={l.id}
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              LABEL_CHIP[l.color as keyof typeof LABEL_CHIP] ?? LABEL_CHIP.GRAY
                            )}
                          >
                            {l.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="max-w-40 px-3 py-2.5 text-muted-foreground">
                  <span className="block truncate">
                    {t.client_name ? `${t.client_name} · ` : ""}
                    {t.project_name}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {t.assigned_name ?? "—"}
                </td>
                <td className="px-3 py-2.5">
                  <StatusDot status={t.status} />
                  <span className="sr-only">{TASK_STATUS_LABELS[t.status]}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS] ?? "—"}
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5",
                    overdue ? "font-medium text-destructive" : "text-muted-foreground"
                  )}
                >
                  {t.deadline ? formatDeadline(t.deadline) : "—"}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    {t.attachments_count > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Paperclip className="size-3" /> {t.attachments_count}
                      </span>
                    )}
                    {t.comments_count > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="size-3" /> {t.comments_count}
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type { ColumnKey };
