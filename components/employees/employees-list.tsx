"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Users, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getTeamMembers,
  manageProfileAction,
  type TeamMember,
} from "@/lib/actions/employees";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

type TeamTab = "ACTIVE" | "PENDING" | "SUSPENDED";
type TeamAction = "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "ROLE_CHANGED";

export function EmployeesList() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TeamTab>("ACTIVE");
  const [pendingAction, setPendingAction] = useState<{
    member: TeamMember;
    action: TeamAction;
    role?: "ADMIN" | "EMPLOYEE";
  } | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await getTeamMembers();
      if (result.success && result.data) setMembers(result.data);
      setLoading(false);
    })();
  }, []);

  async function confirmAction() {
    if (!pendingAction) return;
    setWorking(true);
    const result = await manageProfileAction(
      pendingAction.member.id,
      pendingAction.action,
      pendingAction.role ?? (pendingAction.action === "APPROVE" ? "EMPLOYEE" : undefined)
    );
    setWorking(false);

    if (!result.success) {
      toast.error(result.error ?? "Could not update team member");
      return;
    }

    setMembers((current) =>
      current.map((member) =>
        member.id === result.data?.id ? { ...member, ...result.data } : member
      )
    );
    setPendingAction(null);
    toast.success("Team member updated");
  }

  const visibleMembers = members.filter((member) => member.status === tab);
  const actionLabel = pendingAction?.action === "APPROVE"
    ? "approve"
    : pendingAction?.action === "REACTIVATE"
      ? "reactivate"
      : pendingAction?.action === "REJECT"
        ? "reject"
        : pendingAction?.action === "ROLE_CHANGED"
          ? "change role"
        : "suspend";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage access without removing work history.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
        {(["ACTIVE", "PENDING", "SUSPENDED"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab(value)}
          >
            {value[0] + value.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : visibleMembers.length === 0 ? (
        <EmptyState
          title={`No ${tab.toLowerCase()} team members`}
          description="Matching accounts will appear here."
          icon={<Users />}
        />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {visibleMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-accent/50"
            >
              <Avatar className="size-10 shrink-0">
                <AvatarFallback className="text-sm">
                  {member.full_name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.full_name}</p>
                <p className="truncate text-[13px] text-muted-foreground">{member.email}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {member.role ?? "No role"} · Joined {formatDate(member.created_at)} · {member.projects_count} projects
                </p>
              </div>
              <div className="hidden shrink-0 items-center gap-5 text-xs text-muted-foreground sm:flex">
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {member.active_tasks}
                  </span>
                  active tasks
                </span>
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {member.projects_count}
                  </span>
                  projects
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link href={`/employees/${member.id}`}>
                  <Button type="button" variant="ghost" size="sm">View</Button>
                </Link>
                {member.status === "PENDING" && (
                  <>
                    <Button type="button" size="sm" onClick={() => setPendingAction({ member, action: "APPROVE" })}>
                      <Check className="size-3.5" /> Approve
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ member, action: "APPROVE", role: "ADMIN" })}>
                      Approve as admin
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ member, action: "REJECT" })}>
                      <X className="size-3.5" /> Reject
                    </Button>
                  </>
                )}
                {member.status === "ACTIVE" && (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ member, action: "SUSPEND" })}>Suspend</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPendingAction({ member, action: "ROLE_CHANGED", role: member.role === "ADMIN" ? "EMPLOYEE" : "ADMIN" })}>
                      Make {member.role === "ADMIN" ? "employee" : "admin"}
                    </Button>
                  </>
                )}
                {member.status === "SUSPENDED" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ member, action: "REACTIVATE" })}>
                    Reactivate
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {actionLabel}</DialogTitle>
            <DialogDescription>
              {pendingAction?.member.full_name} will be {actionLabel}d. Existing tasks, comments, payments, and activity remain attached.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingAction(null)}>Cancel</Button>
            <Button
              type="button"
              variant={pendingAction?.action === "SUSPEND" || pendingAction?.action === "REJECT" ? "destructive" : "default"}
              disabled={working}
              onClick={confirmAction}
            >
              {working ? "Working..." : `Confirm ${actionLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
