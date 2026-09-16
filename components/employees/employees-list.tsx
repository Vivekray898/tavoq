"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { getEmployeesWithWorkload } from "@/lib/actions/employees";
import { formatCurrency } from "@/lib/utils";

export function EmployeesList() {
  const [employees, setEmployees] = useState<
    NonNullable<Awaited<ReturnType<typeof getEmployeesWithWorkload>>["data"]>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await getEmployeesWithWorkload();
      if (result.success && result.data) setEmployees(result.data);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Employees</h1>

      {loading ? (
        <SkeletonList rows={5} />
      ) : employees.length === 0 ? (
        <EmptyState
          title="No employees yet"
          description="Employees appear here once they've signed up and been added."
          icon={<Users />}
        />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {employees.map((e) => (
            <Link
              key={e.id}
              href={`/employees/${e.id}`}
              className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-accent/50"
            >
              <Avatar className="size-10 shrink-0">
                <AvatarFallback className="text-sm">
                  {e.full_name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.full_name}</p>
                <p className="truncate text-[13px] text-muted-foreground">{e.email}</p>
              </div>
              <div className="hidden shrink-0 items-center gap-5 text-xs text-muted-foreground sm:flex">
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {e.active_tasks}
                  </span>
                  active
                </span>
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {e.due_today}
                  </span>
                  due today
                </span>
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(e.pending_payout)}
                  </span>
                  pending
                </span>
              </div>
              {!e.active && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Inactive
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
