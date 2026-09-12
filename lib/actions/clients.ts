"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { clientSchema, type ClientInput } from "@/validators/schemas";
import type { ActionResponse, Client } from "@/types/database";

export async function getClients(): Promise<ActionResponse<Client[]>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("name");

    if (error) {
      return { success: false, error: "Failed to load clients" };
    }

    return { success: true, data: data as Client[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function getClient(id: string): Promise<ActionResponse<Client>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return { success: false, error: "Client not found" };
    }

    return { success: true, data: data as Client };
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
      return { success: false, error: "Invalid input" };
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
        logo_url: validated.data.logo_url || null,
        active: validated.data.active ?? true,
      })
      .select()
      .single();

    if (error) {
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
      return { success: false, error: "Invalid input" };
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
        logo_url: validated.data.logo_url || null,
        active: validated.data.active ?? true,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return { success: false, error: "Failed to update client" };
    }

    return { success: true, data: data as Client };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function deleteClientAction(
  id: string
): Promise<ActionResponse> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { error } = await supabase.from("clients").delete().eq("id", id);

    if (error) {
      return { success: false, error: "Failed to delete client" };
    }

    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Get active clients (for dropdowns — accessible to employees too).
 */
export async function getActiveClients(): Promise<ActionResponse<Client[]>> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("active", true)
      .order("name");

    if (error) {
      return { success: false, error: "Failed to load clients" };
    }

    return { success: true, data: data as Client[] };
  } catch {
    return { success: false, error: "Failed to load clients" };
  }
}
