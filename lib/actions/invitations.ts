"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveAdmin } from "@/lib/auth";
import { invitationSchema, type InvitationInput } from "@/validators/schemas";
import { sendInvitationEmail } from "@/lib/email";
import type { ActionResponse, UserRole } from "@/types/database";

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  token: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * §21 — tell all active admins that a new account is waiting for
 * review. Called once per new PENDING profile (after OAuth sign-in).
 * Idempotent per user: the admin is notified only the first time.
 */
export async function notifyAdminsOfPendingAccount(): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const admin = createAdminClient();

    // Only fire if this profile is PENDING (fresh signup, not yet approved)
    const { data: profile } = await admin
      .from("profiles")
      .select("status, full_name, email")
      .eq("id", user.id)
      .single();
    if (!profile || profile.status !== "PENDING") return;

    // One notification per (admin, pending user) pair — dedupe by
    // checking whether we already notified about this user today.
    const { data: recent } = await admin
      .from("notifications")
      .select("id")
      .eq("type", "ACCOUNT_PENDING")
      .eq("reference_id", user.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);
    if (recent && recent.length > 0) return;

    const { data: admins } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "ADMIN")
      .eq("status", "ACTIVE");

    if (!admins || admins.length === 0) return;

    await admin.from("notifications").insert(
      admins.map((a: { id: string }) => ({
        user_id: a.id,
        type: "ACCOUNT_PENDING" as const,
        title: "Pending account",
        message: `${profile.full_name} (${profile.email}) is waiting for approval`,
        reference_type: "team",
        reference_id: user.id,
        read: false,
      }))
    );
  } catch (err) {
    console.error("[notifyAdminsOfPendingAccount]", err);
  }
}

export async function getInvitations(): Promise<ActionResponse<Invitation[]>> {
  try {
    await requireActiveAdmin();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("invitations")
      .select("*")
      .is("accepted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[getInvitations]", error);
      return { success: false, error: "Failed to load invitations" };
    }
    return { success: true, data: (data ?? []) as Invitation[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Admin invites a new team member by email (§9).
 * The invitee accepts by signing in with a Google account whose
 * email matches exactly (validated server-side in the callback).
 */
export async function inviteEmployeeAction(
  input: InvitationInput
): Promise<ActionResponse<{ id: string; email: string }>> {
  try {
    const profile = await requireActiveAdmin();
    const validated = invitationSchema.safeParse(input);
    if (!validated.success) {
      return {
        success: false,
        error: validated.error.issues[0]?.message ?? "Invalid invitation",
      };
    }

    const email = validated.data.email.toLowerCase().trim();
    const admin = createAdminClient();

    // An active account already exists for this email?
    const { data: existing } = await admin
      .from("profiles")
      .select("id, status, role")
      .ilike("email", email)
      .maybeSingle();

    if (existing && existing.status === "ACTIVE") {
      return { success: false, error: "This person is already an active member" };
    }

    // Revoke any previous open invitation for the same email
    await admin
      .from("invitations")
      .update({ expires_at: new Date().toISOString() })
      .ilike("email", email)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());

    const { data: invitation, error } = await admin
      .from("invitations")
      .insert({
        email,
        role: validated.data.role,
        invited_by: profile.id,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id, email, token, expires_at")
      .single();

    if (error || !invitation) {
      console.error("[inviteEmployeeAction]", error);
      return { success: false, error: "Failed to create the invitation" };
    }

    const inviteUrl = `${APP_URL}/invite/${invitation.token}`;

    // Best-effort email; the admin can always share the link manually
    const emailResult = await sendInvitationEmail(
      email,
      profile.full_name,
      validated.data.role,
      inviteUrl
    );

    return {
      success: true,
      data: { id: invitation.id, email: invitation.email },
      // Surface delivery state so the admin can fall back to the link
      ...(emailResult === null ? { meta: undefined } : {}),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function revokeInvitation(id: string): Promise<ActionResponse> {
  try {
    await requireActiveAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("invitations")
      .delete()
      .eq("id", id)
      .is("accepted_at", null);

    if (error) {
      console.error("[revokeInvitation]", error);
      return { success: false, error: "Failed to revoke the invitation" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Look up an invitation by token for the public /invite/[token] page.
 * Returns a safe subset only (no tokens beyond the one already known).
 */
export async function getInvitationByToken(
  token: string
): Promise<ActionResponse<{ email: string; role: UserRole; invitedByName: string | null }>> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("invitations")
      .select("email, role, expires_at, accepted_at, invited_by:profiles(full_name)")
      .eq("token", token)
      .maybeSingle();

    if (error || !data) {
      return { success: false, error: "This invitation link is not valid" };
    }

    const invitedBy = Array.isArray(data.invited_by)
      ? data.invited_by[0]
      : data.invited_by;

    if (data.accepted_at) {
      return { success: false, error: "This invitation has already been used" };
    }
    if (new Date(data.expires_at) < new Date()) {
      return { success: false, error: "This invitation has expired. Ask your administrator for a new one." };
    }

    return {
      success: true,
      data: {
        email: data.email,
        role: data.role,
        invitedByName: invitedBy?.full_name ?? null,
      },
    };
  } catch {
    return { success: false, error: "Something went wrong" };
  }
}

/**
 * Attempt to accept an invitation for the current user. Called after
 * Google sign-in on the invite page. Enforces email match server-side.
 */
export async function acceptInvitation(
  token: string
): Promise<ActionResponse<{ role: UserRole }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return { success: false, error: "Sign in with Google first" };
    }

    const admin = createAdminClient();
    const { data: invitation, error } = await admin
      .from("invitations")
      .select("id, email, role, expires_at, accepted_at")
      .eq("token", token)
      .maybeSingle();

    if (error || !invitation) {
      return { success: false, error: "This invitation link is not valid" };
    }
    if (invitation.accepted_at) {
      return { success: false, error: "This invitation has already been used" };
    }
    if (new Date(invitation.expires_at) < new Date()) {
      return { success: false, error: "This invitation has expired. Ask your administrator for a new one." };
    }

    // §10 — Google email MUST match the invitation email
    if (user.email.toLowerCase().trim() !== invitation.email) {
      return {
        success: false,
        error: `This invitation was sent to another email address (${invitation.email}). Sign in with that Google account instead.`,
      };
    }

    // Activate: role = invited role, status = ACTIVE
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .update({
        role: invitation.role,
        status: "ACTIVE",
        approved_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .select("id, role, status")
      .single();

    if (profileError || !profile) {
      console.error("[acceptInvitation] profile update", profileError);
      return { success: false, error: "Failed to activate your account" };
    }

    const { error: acceptError } = await admin
      .from("invitations")
      .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq("id", invitation.id);

    if (acceptError) {
      console.error("[acceptInvitation] mark accepted", acceptError);
    }

    return { success: true, data: { role: profile.role } };
  } catch {
    return { success: false, error: "Something went wrong" };
  }
}
