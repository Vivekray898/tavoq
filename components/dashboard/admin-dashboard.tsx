"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  FolderKanban,
  CheckSquare,
  Clock,
  AlertTriangle,
  Eye,
  IndianRupee,
  TrendingUp,
  Calendar,
  MessageSquare,
  PlusCircle,
  CheckCircle2,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonDashboard } from "@/components/shared/skeleton-loader";
import { createClient } from "@/lib/supabase/client";
import { getGreeting, formatCurrency, getRelativeTime, formatDate } from "@/lib/utils";
import {
  getAdminDashboardStats,
  getUpcomingDeadlines,
  getRecentActivity,
  type AdminDashboardStats,
  type UpcomingDeadline,
  type RecentActivity,
} from "@/lib/actions/dashboard";
import type { Profile } from "@/types/database";

interface AdminDashboardProps {
  profile: Profile;
}

export function AdminDashboard({ profile }: AdminDashboardProps) {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [deadlines, setDeadlines] = useState<UpcomingDeadline[]>([]);
  const [activity, setActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  // Avoid overlapping refetches
  const isFetchingRef = useRef(false);

  const refreshAll = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const [statsRes, deadlinesRes, activityRes] = await Promise.all([
        getAdminDashboardStats(),
        getUpcomingDeadlines(5),
        getRecentActivity(8),
      ]);

      if (statsRes.success && statsRes.data) setStats(statsRes.data);
      if (deadlinesRes.success && deadlinesRes.data)
        setDeadlines(deadlinesRes.data);
      if (activityRes.success && activityRes.data)
        setActivity(activityRes.data);
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

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("admin-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => {
          // Debounce: any task change → refresh stats + deadlines + activity
          refreshAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        () => {
          refreshAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_comments" },
        () => {
          refreshAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
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
  }, [refreshAll]);

  if (loading) {
    return <SkeletonDashboard />;
  }

  const statCards = [
    {
      title: "Active Projects",
      value: stats?.activeProjects ?? 0,
      icon: FolderKanban,
      color: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-900/20",
    },
    {
      title: "Active Tasks",
      value: stats?.activeTasks ?? 0,
      icon: CheckSquare,
      color: "text-green-600",
      bg: "bg-green-50 dark:bg-green-900/20",
    },
    {
      title: "Due Today",
      value: stats?.dueToday ?? 0,
      icon: Clock,
      color: "text-orange-600",
      bg: "bg-orange-50 dark:bg-orange-900/20",
    },
    {
      title: "Overdue",
      value: stats?.overdue ?? 0,
      icon: AlertTriangle,
      color: "text-red-600",
      bg: "bg-red-50 dark:bg-red-900/20",
    },
    {
      title: "Needs Review",
      value: stats?.needsReview ?? 0,
      icon: Eye,
      color: "text-purple-600",
      bg: "bg-purple-50 dark:bg-purple-900/20",
    },
    {
      title: "Pending Payments",
      value: formatCurrency(stats?.pendingPayments ?? 0),
      icon: IndianRupee,
      color: "text-yellow-600",
      bg: "bg-yellow-50 dark:bg-yellow-900/20",
    },
    {
      title: "Paid This Month",
      value: formatCurrency(stats?.paidThisMonth ?? 0),
      icon: TrendingUp,
      color: "text-emerald-600",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
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
            Here&apos;s what&apos;s happening with your agency today.
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

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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

      {/* Upcoming Deadlines & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Deadlines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="size-4" />
              Upcoming Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            {deadlines.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No upcoming deadlines
              </p>
            ) : (
              <div className="space-y-3">
                {deadlines.map((task) => {
                  const deadlineDate = new Date(task.deadline);
                  const now = new Date();
                  const diffMs = deadlineDate.getTime() - now.getTime();
                  const diffHours = diffMs / (1000 * 60 * 60);
                  const isUrgent = diffHours < 24;

                  return (
                    <Link
                      key={task.id}
                      href={`/tasks/${task.id}`}
                      className="flex items-start gap-3 p-2 -mx-2 rounded-lg hover:bg-accent transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">
                            {task.title}
                          </p>
                          {isUrgent && (
                            <Badge
                              variant="destructive"
                              className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                            >
                              Urgent
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {task.project_name}
                          {task.assigned_name && ` · ${task.assigned_name}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-medium">
                          {formatDate(task.deadline)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {getRelativeTime(task.deadline)}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recent activity
              </p>
            ) : (
              <div className="space-y-3">
                {activity.map((item) => {
                  const Icon =
                    item.type === "comment"
                      ? MessageSquare
                      : item.type === "task_completed"
                        ? CheckCircle2
                        : PlusCircle;
                  const color =
                    item.type === "comment"
                      ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20"
                      : item.type === "task_completed"
                        ? "text-green-600 bg-green-50 dark:bg-green-900/20"
                        : "text-purple-600 bg-purple-50 dark:bg-purple-900/20";

                  return (
                    <div key={item.id} className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-md shrink-0 ${color}`}>
                        <Icon className="size-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.description}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {getRelativeTime(item.created_at)}
                        </p>
                        {item.user_name && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                            {item.user_name}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}