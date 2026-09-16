"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import {
  getTeamMembers,
  manageProfileAction,
  type TeamMember,
} from "@/lib/actions/employees";
import {
  getInvitations,
  inviteEmployeeAction,
  revokeInvitation,
  type Invitation,
} from "@/lib/actions/invitations";
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
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"EMPLOYEE" | "ADMIN">("EMPLOYEE");
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [membersRes, invitesRes] = await Promise.all([
      getTeamMembers(),
      getInvitations(),
    ]);
    if (membersRes.success && membersRes.data) setMembers(membersRes.data);
    if (invitesRes.success && invitesRes.data) setInvitations(invitesRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

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
                      {invitation.role === "ADMIN" ? "Admin" : "Employee"} · sent {formatDate(invitation.created_at)} · expires {formatDate(invitation.expires_at)}
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
                        setInvitations((prev) => prev.filter((i) => i.id !== invitation.id));
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
                await load();
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
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "EMPLOYEE" | "ADMIN")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPLOYEE">Employee</SelectItem>
                    <SelectItem value="ADMIN">Admin</SelectItem>
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
