"use client";

import { useEffect, useState } from "react";
import { Users, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonCard } from "@/components/shared/skeleton-loader";
import { getActiveEmployees } from "@/lib/actions/employees";
import { getInitials, formatDate } from "@/lib/utils";
import type { Profile } from "@/types/database";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await getActiveEmployees();
      if (result.success && result.data) {
        setEmployees(result.data);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Manage your team members"
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <EmptyState
          title="No employees yet"
          description="Add employees to start assigning work."
          icon={<Users className="size-8 text-muted-foreground" />}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((employee) => (
            <Card key={employee.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback className="text-sm">
                      {getInitials(employee.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{employee.full_name}</h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {employee.email}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={employee.active
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-gray-100 text-gray-500"
                    }
                  >
                    {employee.active ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                  {employee.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="size-3" />
                      {employee.phone}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    Joined {formatDate(employee.created_at)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
