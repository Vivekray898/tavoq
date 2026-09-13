"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Clock,
  Eye,
  CheckCircle,
  IndianRupee,
  ArrowRight,
  Calendar,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonDashboard } from "@/components/shared/skeleton-loader";
import { TaskStatusBadge } from "@/components/shared/status-badge";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { createClient } from "@/lib/supabase/client";
import {
  getGreeting,
  formatCurrency,
  formatDate,
  getRelativeTime,
  isDueSoon,
} from "@/lib/utils";
import {
  getEmployeeDashboardStats,
  getMyActiveTasks,
  type EmployeeDashboardStats,
} from "@/lib/actions/employee-dashboard";
import type { Profile, Task } from "@/types/database";

interface EmployeeDashboardProps {
  profile: Profile;
}

export function EmployeeDashboard({ profile }: EmployeeDashboardProps) {
  const [stats, setStats] = useState<EmployeeDashboardStats | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const isFetchingRef = useRef(false);

  const refreshAll = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const [statsRes, tasksRes] = await Promise.all([
        getEmployeeDashboardStats(),
        getMyActiveTasks(10),
      ]);
      if (statsRes.success && statsRes.data) setStats(statsRes.data);
      if (tasksRes.success && tasksRes.data) setTasks(tasksRes.data);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      await refreshAll();
      setLoading(false);
    })();
  }, [refreshAll]);

  // Realtime: watch this employee's tasks + payments
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`employee-dashboard-${profile.id}`)
      // Tasks assigned to me changing (status, deadline, payout, etc.)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `assigned_to=eq.${profile.id}`,
        },
        () => {
          refreshAll();
        }
      )
      // Payments affecting my tasks (admin marks paid)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payments",
        },
        () => {
          refreshAll();
        }
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id, refreshAll]);

  if (loading) {
    return <SkeletonDashboard />;
  }

  const statCards = [
    {
      title: "Due Today",
      value: stats?.dueToday ?? 0,
      icon: Clock,
      color: "text-orange-600",
      bg: "bg-orange-50 dark:bg-orange-900/20",
    },
    {
      title: "Needs Review",
      value: stats?.needsReview ?? 0,
      icon: Eye,
      color: "text-purple-600",
      bg: "bg-purple-50 dark:bg-purple-900/20",
    },
    {
      title: "Completed This Month",
      value: stats?.completed ?? 0,
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50 dark:bg-green-900/20",
    },
    {
      title: "Pending Payment",
      value: formatCurrency(stats?.pendingPayment ?? 0),
      icon: IndianRupee,
      color: "text-yellow-600",
      bg: "bg-yellow-50 dark:bg-yellow-900/20",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {getGreeting()}, {profile.full_name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here&apos;s what you need to work on today.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <span
            className={`inline-block size-2 rounded-full ${
              live ? "bg-green-500 animate-pulse" : "bg-gray-400"
            }`}
          />
          {live ? "Live" : "Connecting…"}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${stat.bg}`}>
                  <stat.icon className={`size-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active Tasks */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">My Tasks</h2>
          <Link href="/tasks">
            <Button variant="ghost" size="sm">
              View all
              <ArrowRight className="size-4 ml-1" />
            </Button>
          </Link>
        </div>

        <div className="space-y-3">
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  You&apos;re all caught up 🎉
                </p>
              </CardContent>
            </Card>
          ) : (
            tasks.map((task) => {
              const urgent = task.deadline && isDueSoon(task.deadline);
              return (
                <Link key={task.id} href={`/tasks/${task.id}`}>
                  <Card className="hover:shadow-sm transition-shadow cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium truncate">
                              {task.title}
                            </h3>
                            {urgent && (
                              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                                <Clock className="size-3" />
                                Due soon
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <TaskStatusBadge status={task.status} />
                            <PriorityBadge priority={task.priority} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {task.deadline && (
                            <>
                              <p className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                                <Calendar className="size-3" />
                                {formatDate(task.deadline)}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {getRelativeTime(task.deadline)}
                              </p>
                            </>
                          )}
                          {task.payout_amount > 0 && (
                            <p className="text-sm font-medium text-green-600 mt-1">
                              {formatCurrency(task.payout_amount)}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}