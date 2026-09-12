"use client";

import { useEffect, useState } from "react";
import {
  FolderKanban,
  CheckSquare,
  Clock,
  AlertTriangle,
  Eye,
  IndianRupee,
  TrendingUp,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonDashboard } from "@/components/shared/skeleton-loader";
import { getGreeting, formatCurrency } from "@/lib/utils";
import type { Profile } from "@/types/database";

interface AdminDashboardProps {
  profile: Profile;
}

interface DashboardStats {
  activeProjects: number;
  activeTasks: number;
  dueToday: number;
  overdue: number;
  needsReview: number;
  pendingPayments: number;
  paidThisMonth: number;
}

export function AdminDashboard({ profile }: AdminDashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch real stats from Supabase
    // For now, use placeholder data
    setTimeout(() => {
      setStats({
        activeProjects: 8,
        activeTasks: 24,
        dueToday: 4,
        overdue: 2,
        needsReview: 3,
        pendingPayments: 4500,
        paidThisMonth: 18200,
      });
      setLoading(false);
    }, 500);
  }, []);

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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {getGreeting()}, {profile.full_name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s what&apos;s happening with your agency today.
        </p>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="size-4" />
              Upcoming Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* TODO: Fetch real data */}
              <p className="text-sm text-muted-foreground text-center py-4">
                No upcoming deadlines
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="size-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* TODO: Fetch real data */}
              <p className="text-sm text-muted-foreground text-center py-4">
                No recent activity
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
