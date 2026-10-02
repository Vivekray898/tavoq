"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Mail, Send, Trash2, Users, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { EmptyState } from "@/components/shared/empty-state";
import { manageProfileAction, type TeamMember } from "@/lib/actions/employees";
import { useSession } from "@/components/providers/session-provider";
import {
  can,
  canManageProfile,
  invitableRoles,
  ROLE_LABELS,
} from "@/lib/permissions";
import type { UserRole } from "@/types/database";
import {
  getInvitations,
  inviteEmployeeAction,
  revokeInvitation,
  type Invitation,
} from "@/lib/actions/invitations";
import {
  teamMembersOptions,
} from "@/lib/queries/options";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";

type TeamTab = "ACTIVE" | "PENDING" | "SUSPENDED";
type TeamAction = "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "ROLE_CHANGED";

const invitationsOptions = {
  queryKey: ["invitations"] as const,
  queryFn: async () => {
    const res = await getInvitations();
    if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load invitations");
    return res.data as Invitation[];
  },
  staleTime: 120_000,
};

export function EmployeesList() {
  const queryClient = useQueryClient();
  const teamQuery = useQuery(teamMembersOptions);
  const invitesQuery = useQuery(invitationsOptions);

  const members = teamQuery.data ?? [];
  const invitations = invitesQuery.data ?? [];
  const loading = teamQuery.isLoading;

  // ── Role-aware controls ────────────────────────────────────
  //
  // Cosmetic only: manageProfileAction and the
  // manage_profile_lifecycle() RPC are the real authorization. These
  // predicates exist so a manager is not offered a button that would
  // be refused, and so a manager never sees actions on a peer.
  const { role } = useSession();
  const canChangeRoles = can(role, "profiles.changeRole");

  /**
   * May this role act on a target with `targetRole`, granting
   * `requestedRole`? Mirrors canManageProfile() exactly, so the UI
   * and the server never disagree about who may do what.
   */
  const canActOn = (
    targetRole: TeamMember["role"],
    action: Parameters<typeof canManageProfile>[2],
    requestedRole?: UserRole
  ) => canManageProfile(role, targetRole, action, requestedRole ?? null);

  const [tab, setTab] = useState<TeamTab>("ACTIVE");
  const [pendingAction, setPendingAction] = useState<{
    member: TeamMember;
    action: TeamAction;
    role?: UserRole;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  // Which roles this actor may invite. A manager may only onboard
  // EMPLOYEE; a super admin may also invite MANAGER. SUPER_ADMIN is
  // deliberately not offered — minting an org owner is done in the
  // database, never through an invite link.
  const [inviteRole, setInviteRole] = useState<UserRole>("EMPLOYEE");
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  async function confirmAction() {
    if (!pendingAction) return;
    setWorking(true);

    const { member, action, role } = pendingAction;
    const requestedRole =
      role ?? (action === "APPROVE" ? ("EMPLOYEE" as UserRole) : undefined);

    // ── Optimistic (§38) ──
    // An approval moves the row between the PENDING and ACTIVE tabs, so
    // waiting for the round-trip leaves the dialog feeling broken.
    // Patch the badge now, restore the snapshot if the server refuses.
    const snapshot = queryClient.getQueryData<TeamMember[]>(
      teamMembersOptions.queryKey
    );

    const optimisticStatus =
      action === "APPROVE"
        ? ("ACTIVE" as const)
        : action === "REJECT" || action === "SUSPEND"
          ? ("SUSPENDED" as const)
          : action === "REACTIVATE"
            ? ("ACTIVE" as const)
            : undefined;

    if (optimisticStatus) {
      queryClient.setQueryData<TeamMember[]>(teamMembersOptions.queryKey, (current) =>
        current?.map((m) =>
          m.id === member.id
            ? { ...m, status: optimisticStatus, ...(requestedRole ? { role: requestedRole } : {}) }
            : m
        )
      );
    }

    const result = await manageProfileAction(member.id, action, requestedRole);
    setWorking(false);

    if (!result.success) {
      queryClient.setQueryData(teamMembersOptions.queryKey, snapshot);
      toast.error(result.error ?? "Could not update team member");
      return;
    }

    // Targeted: patch the changed member in the cached team list.
    queryClient.setQueryData<TeamMember[]>(teamMembersOptions.queryKey, (current) =>
      current?.map((m) =>
        m.id === result.data?.id ? { ...m, ...result.data } : m
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

      {tab === "PENDING" && !loading && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Open invitations ({invitations.length})
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
              <Mail className="size-3.5" /> Invite employee
            </Button>
          </div>
          {invitations.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground">
              No open invitations. Use “Invite employee” to add someone by email before they sign in with Google.
            </p>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {invitations.map((invitation) => (
                <div key={invitation.id} className="flex items-center gap-3 px-4 py-3">
                  <Mail className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {invitation.role === "SUPER_ADMIN" ? "Admin" : "Employee"} · sent {formatDate(invitation.created_at)} · expires {formatDate(invitation.expires_at)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Copy invite link for ${invitation.email}`}
                    onClick={() => {
                      const url = `${window.location.origin}/invite/${invitation.token}`;
                      void navigator.clipboard.writeText(url);
                      toast.success("Invite link copied");
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Revoke invitation for ${invitation.email}`}
                    onClick={async () => {
                      const res = await revokeInvitation(invitation.id);
                      if (res.success) {
                        queryClient.setQueryData<Invitation[]>(invitationsOptions.queryKey, (prev) =>
                          (prev ?? []).filter((i) => i.id !== invitation.id)
                        );
                        toast.success("Invitation revoked");
                      } else {
                        toast.error(res.error ?? "Couldn't revoke the invitation");
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
              className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-3.5"
            >
              {/* Profile Info */}
              <div className="flex items-center gap-3.5 flex-1 min-w-0">
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
              </div>

              {/* Stats - Visible on mobile as grid, hidden on desktop because they show in the row */}
              <div className="flex sm:hidden items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {member.active_tasks}
                  </span>
                  active
                </span>
                <span className="text-center">
                  <span className={cn("block text-sm font-semibold tabular-nums", member.overdue_tasks > 0 && "text-destructive")}>
                    {member.overdue_tasks}
                  </span>
                  overdue
                </span>
                <span className="text-center">
                  <span className={cn("block text-sm font-semibold tabular-nums", member.awaiting_review > 0 && "text-violet-600 dark:text-violet-400")}>
                    {member.awaiting_review}
                  </span>
                  in review
                </span>
                <span className="text-center">
                  <span className={cn("block text-sm font-semibold tabular-nums", member.pending_payment > 0 && "text-amber-600 dark:text-amber-400")}>
                    {formatCurrency(member.pending_payment)}
                  </span>
                  pending
                </span>
              </div>

              {/* Stats - Hidden on mobile, shown on desktop */}
              <div className="hidden shrink-0 items-center gap-5 text-xs text-muted-foreground sm:flex">
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {member.active_tasks}
                  </span>
                  active
                </span>
                <span className="text-center">
                  <span className={cn("block text-sm font-semibold tabular-nums", member.overdue_tasks > 0 && "text-destructive")}>
                    {member.overdue_tasks}
                  </span>
                  overdue
                </span>
                <span className="text-center">
                  <span className={cn("block text-sm font-semibold tabular-nums", member.awaiting_review > 0 && "text-violet-600 dark:text-violet-400")}>
                    {member.awaiting_review}
                  </span>
                  in review
                </span>
                <span className="text-center">
                  <span className={cn("block text-sm font-semibold tabular-nums", member.pending_payment > 0 && "text-amber-600 dark:text-amber-400")}>
                    {formatCurrency(member.pending_payment)}
                  </span>
                  pending pay
                </span>
                <span className="text-center">
                  <span className="block text-sm font-semibold tabular-nums text-foreground">
                    {member.projects_count}
                  </span>
                  projects
                </span>
              </div>{/* Action Buttons
                    *
                    * Visibility is cosmetic — manageProfileAction and the
                    * manage_profile_lifecycle() RPC are the real gate, and
                    * they reject a manager touching a MANAGER/SUPER_ADMIN
                    * target or granting a privileged role.
                    *
                    * canManageProfile() with requestedRole is what hides
                    * "Approve as admin" from a manager and blocks every
                    * action on a privileged row. */}
                <div className="flex flex-wrap shrink-0 items-center gap-1">
                  <Link href={`/employees/${member.id}`}>
                    <Button type="button" variant="ghost" size="sm">View</Button>
                  </Link>
                  {canActOn(member.role, "APPROVE", "EMPLOYEE") && member.status === "PENDING" && (
                    <>
                      <Button type="button" size="sm" onClick={() => setPendingAction({ member, action: "APPROVE", role: "EMPLOYEE" })}>
                        <Check className="size-3.5" /> Approve
                      </Button>
                      {canActOn(member.role, "APPROVE", "SUPER_ADMIN") && (
                        <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ member, action: "APPROVE", role: "SUPER_ADMIN" })}>
                          Approve as admin
                        </Button>
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ member, action: "REJECT" })}>
                        <X className="size-3.5" /> Reject
                      </Button>
                    </>
                  )}
                  {canActOn(member.role, "SUSPEND") && member.status === "ACTIVE" && (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ member, action: "SUSPEND" })}>Suspend</Button>
                      {/* Role changes are super-admin only. */}
                      {canChangeRoles && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setPendingAction({ member, action: "ROLE_CHANGED", role: member.role === "SUPER_ADMIN" ? "EMPLOYEE" : "SUPER_ADMIN" })}>
                          Make {member.role === "SUPER_ADMIN" ? "employee" : "admin"}
                        </Button>
                      )}
                    </>
                  )}
                  {canActOn(member.role, "REACTIVATE") && member.status === "SUSPENDED" && (
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

      {/* §9 — Invite by email */}
      <Dialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) setLastInviteUrl(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite employee</DialogTitle>
            <DialogDescription>
              They&apos;ll accept by signing in with the Google account for this email address.
            </DialogDescription>
          </DialogHeader>
          {lastInviteUrl ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Invitation created. An email is on its way if delivery is configured — you can also share this link directly:
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={lastInviteUrl} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(lastInviteUrl);
                    toast.success("Invite link copied");
                  }}
                >
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => { setInviteOpen(false); setInviteEmail(""); }}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setInviting(true);
                const result = await inviteEmployeeAction({ email: inviteEmail, role: inviteRole });
                setInviting(false);
                if (!result.success) {
                  toast.error(result.error ?? "Couldn't send the invitation");
                  return;
                }
                const tokenRes = await getInvitations();
                const fresh = tokenRes.data?.find((i) => i.email === inviteEmail.toLowerCase().trim());
                if (fresh) setLastInviteUrl(`${window.location.origin}/invite/${fresh.token}`);
                await queryClient.invalidateQueries({ queryKey: invitationsOptions.queryKey });
                setTab("PENDING");
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="invite-email" className="text-sm font-medium">Email</label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="rahul@gmail.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Role</label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {invitableRoles(role).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send invitation
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}