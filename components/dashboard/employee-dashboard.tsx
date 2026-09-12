"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Eye, CheckCircle, IndianRupee, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonDashboard } from "@/components/shared/skeleton-loader";
import { TaskStatusBadge } from "@/components/shared/status-badge";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { getGreeting, formatCurrency, formatDate } from "@/lib/utils";
import type { Profile, Task } from "@/types/database";

interface EmployeeDashboardProps {
  profile: Profile;
}

interface DashboardStats {
  dueToday: number;
  needsReview: number;
  completed: number;
  pendingPayment: number;
}

export function EmployeeDashboard({ profile }: EmployeeDashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch real data from Supabase
    setTimeout(() => {
      setStats({
        dueToday: 3,
        needsReview: 1,
        completed: 18,
        pendingPayment: 1500,
      });
      setTasks([
        {
          id: "1",
          project_id: "1",
          assigned_to: profile.id,
          title: "Create 5 Instagram Posts",
          description: null,
          status: "IN_PROGRESS",
          priority: "HIGH",
          deadline: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          payout_amount: 500,
          payment_status: "PENDING",
          created_by: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
        {
          id: "2",
          project_id: "1",
          assigned_to: profile.id,
          title: "Edit September Reel",
          description: null,
          status: "TODO",
          priority: "MEDIUM",
          deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          payout_amount: 300,
          payment_status: "NOT_APPLICABLE",
          created_by: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      ]);
      setLoading(false);
    }, 500);
  }, [profile.id]);

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
      title: "Completed",
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {getGreeting()}, {profile.full_name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s what you need to work on today.
        </p>
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

      {/* Today's Tasks */}
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
            tasks.map((task) => (
              <Link key={task.id} href={`/tasks/${task.id}`}>
                <Card className="hover:shadow-sm transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{task.title}</h3>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <TaskStatusBadge status={task.status} />
                          <PriorityBadge priority={task.priority} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {task.deadline && (
                          <p className="text-sm text-muted-foreground">
                            {formatDate(task.deadline)}
                          </p>
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
