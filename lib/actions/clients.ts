"use server";

import { createClient } from "@/lib/supabase/server";
import { requireStaff, requireSuperAdmin } from "@/lib/auth";
import { clientSchema, type ClientInput } from "@/validators/schemas";
import type { ActionResponse, Client } from "@/types/database";

export async function getClients(
  options?: { archived?: boolean }
): Promise<
  ActionResponse<Array<Client & { projects_count: number }>>
> {
  try {
    await requireStaff();

    const supabase = await createClient();
    // §43 — Active and Archived are separate views
    let query = supabase.from("clients").select("*").order("name");
    query = options?.archived
      ? query.eq("active", false)
      : query.eq("active", true);

    // The per-client project counts do not depend on the client rows —
    // they are keyed by client_id on the projects side — so both reads
    // are in flight together rather than one after the other.
    const projectsPromise = supabase
      .from("projects")
      .select("client_id")
      .neq("status", "ARCHIVED");

    const [{ data, error }, { data: projects }] = await Promise.all([
      query,
      projectsPromise,
    ]);
    if (error) {
      console.error("[getClients]", error);
      return { success: false, error: "Failed to load clients" };
    }

    const counts = new Map<string, number>();
    (projects ?? []).forEach((p: { client_id: string }) => {
      counts.set(p.client_id, (counts.get(p.client_id) ?? 0) + 1);
    });

    return {
      success: true,
      data: (data ?? []).map((c) => ({
        ...(c as Client),
        projects_count: counts.get(c.id) ?? 0,
      })),
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export interface ClientDetail extends Client {
  projects: Array<{
    id: string;
    name: string;
    status: string;
    active_tasks: number;
  }>;
  /** §17 — operational snapshot over this client's non-archived projects */
  task_stats: {
    active: number;
    completed: number;
    overdue: number;
  };
}

export async function getClient(id: string): Promise<ActionResponse<ClientDetail>> {
  try {
    await requireStaff();

    const supabase = await createClient();

    // The client row and its projects key off the `id` argument, not off
    // each other, so they are issued together. Previously this was a
    // three-wave read: client -> projects -> tasks -> tasks again.
    const clientPromise = supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    const projectsPromise = supabase
      .from("projects")
      .select("id, name, status")
      .eq("client_id", id)
      .neq("status", "ARCHIVED")
      .order("created_at", { ascending: false });

    const [{ data, error }, { data: projects }] = await Promise.all([
      clientPromise,
      projectsPromise,
    ]);

    if (error || !data) {
      return { success: false, error: "Client not found" };
    }

    // One task read feeds both outputs. The per-project active counts
    // used to be a separate query selecting only `project_id`; the
    // stats query below selects status and deadline for the same rows,
    // so it is a strict superset and the extra round-trip bought
    // nothing.
    const projectIds = (projects ?? []).map((p: { id: string }) => p.id);
    const counts = new Map<string, number>();
    const taskStats = { active: 0, completed: 0, overdue: 0 };

    if (projectIds.length > 0) {
      const { data: statTasks } = await supabase
        .from("tasks")
        .select("status, deadline, project_id")
        .in("project_id", projectIds);

      const now = Date.now();
      for (const t of (statTasks ?? []) as Array<{
        status: string;
        deadline: string | null;
        project_id: string;
      }>) {
        if (t.status === "COMPLETED") {
          taskStats.completed += 1;
          continue;
        }
        // Active per project (§17 counts) and overall task_stats.
        counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
        taskStats.active += 1;
        if (t.deadline && new Date(t.deadline).getTime() < now) taskStats.overdue += 1;
      }
    }

    return {
      success: true,
      data: {
        ...(data as Client),
        projects: (projects ?? []).map((p: { id: string; name: string; status: string }) => ({
          ...p,
          active_tasks: counts.get(p.id) ?? 0,
        })),
        task_stats: taskStats,
      },
    };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function createClientAction(
  input: ClientInput
): Promise<ActionResponse<Client>> {
  try {
    await requireStaff();

    const validated = clientSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .insert({
        name: validated.data.name,
        company_name: validated.data.company_name || null,
        email: validated.data.email || null,
        phone: validated.data.phone || null,
        website: validated.data.website || null,
        notes: validated.data.notes || null,
        active: validated.data.active ?? true,
      })
      .select()
      .single();

    if (error) {
      console.error("[createClientAction]", error);
      return { success: false, error: "Failed to create client" };
    }

    return { success: true, data: data as Client };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function updateClientAction(
  id: string,
  input: ClientInput
): Promise<ActionResponse<Client>> {
  try {
    await requireStaff();

    const validated = clientSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.issues[0]?.message ?? "Invalid input" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .update({
        name: validated.data.name,
        company_name: validated.data.company_name || null,
        email: validated.data.email || null,
        phone: validated.data.phone || null,
        website: validated.data.website || null,
        notes: validated.data.notes || null,
        active: validated.data.active ?? true,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[updateClientAction]", error);
      return { success: false, error: "Failed to update client" };
    }

    return { success: true, data: data as Client };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Archive instead of delete (§56) — keeps history intact */
export async function archiveClientAction(id: string): Promise<ActionResponse> {
  try {
    const profile = await requireStaff();
    const supabase = await createClient();
    const { error } = await supabase
      .from("clients")
      .update({ active: false })
      .eq("id", id);
    if (error) {
      console.error("[archiveClientAction]", error);
      return { success: false, error: "Failed to archive client" };
    }
    const { error: auditError } = await supabase.from("admin_audit_log").insert({
      actor_id: profile.id,
      action: "CLIENT_ARCHIVED",
      detail: id,
    });
    if (auditError) return { success: false, error: "Client archived, but audit logging failed" };
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** §47 — restore returns the client to the active list */
export async function restoreClientAction(id: string): Promise<ActionResponse> {
  try {
    await requireStaff();
    const supabase = await createClient();
    const { error } = await supabase
      .from("clients")
      .update({ active: true })
      .eq("id", id);
    if (error) {
      console.error("[restoreClientAction]", error);
      return { success: false, error: "Failed to restore client" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Permanent delete — only when the client has no projects left */
export async function deleteClientAction(id: string): Promise<ActionResponse> {
  try {
    // Hard delete is super-admin only (matrix: managers cannot delete clients).
    await requireSuperAdmin();
    const supabase = await createClient();

    const { count: projectCount } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id);

    if ((projectCount ?? 0) > 0) {
      return {
        success: false,
        error: `This client still has ${projectCount} project${projectCount === 1 ? "" : "s"}. Delete or reassign those first.`,
      };
    }

    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) {
      console.error("[deleteClientAction]", error);
      return {
        success: false,
        error: "Couldn't delete the client. It may have related records that need to be handled first.",
      };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Used by project/task forms */
export async function getActiveClients(): Promise<ActionResponse<Client[]>> {
  try {
    await requireStaff();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("active", true)
      .order("name");

    if (error) {
      return { success: false, error: "Failed to load clients" };
    }
    return { success: true, data: (data ?? []) as Client[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
