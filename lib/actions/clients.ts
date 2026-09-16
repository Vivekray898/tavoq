"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { clientSchema, type ClientInput } from "@/validators/schemas";
import type { ActionResponse, Client } from "@/types/database";

export async function getClients(): Promise<
  ActionResponse<Array<Client & { projects_count: number }>>
> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("name");

    if (error) {
      console.error("[getClients]", error);
      return { success: false, error: "Failed to load clients" };
    }

    // Count non-archived projects per client
    const { data: projects } = await supabase
      .from("projects")
      .select("client_id")
      .neq("status", "ARCHIVED");

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
}

export async function getClient(id: string): Promise<ActionResponse<ClientDetail>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return { success: false, error: "Client not found" };
    }

    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, status")
      .eq("client_id", id)
      .neq("status", "ARCHIVED")
      .order("created_at", { ascending: false });

    // Active task counts per project
    const projectIds = (projects ?? []).map((p: { id: string }) => p.id);
    const counts = new Map<string, number>();
    if (projectIds.length > 0) {
      const { data: tasks } = await supabase
        .from("tasks")
        .select("project_id")
        .in("project_id", projectIds)
        .not("status", "in", '("COMPLETED")');
      (tasks ?? []).forEach((t: { project_id: string }) => {
        counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
      });
    }

    return {
      success: true,
      data: {
        ...(data as Client),
        projects: (projects ?? []).map((p: { id: string; name: string; status: string }) => ({
          ...p,
          active_tasks: counts.get(p.id) ?? 0,
        })),
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
    await requireAdmin();

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
    await requireAdmin();

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
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("clients")
      .update({ active: false })
      .eq("id", id);
    if (error) {
      console.error("[archiveClientAction]", error);
      return { success: false, error: "Failed to archive client" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/** Used by project/task forms */
export async function getActiveClients(): Promise<ActionResponse<Client[]>> {
  try {
    await requireAdmin();
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
