"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { ActionResponse, Payment } from "@/types/database";

export async function getPendingPayments(): Promise<ActionResponse<Payment[]>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payments")
      .select("*, task:tasks(title, assigned_to, assigned_user:profiles!tasks_assigned_to_fkey(full_name))")
      .is("paid_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: "Failed to load payments" };
    }

    return { success: true, data: data as Payment[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function getPaidPayments(
  month?: string
): Promise<ActionResponse<Payment[]>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    let query = supabase
      .from("payments")
      .select("*, task:tasks(title, assigned_to, assigned_user:profiles!tasks_assigned_to_fkey(full_name))")
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: false });

    if (month) {
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      query = query.gte("paid_at", startDate).lte("paid_at", endDate);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: "Failed to load payments" };
    }

    return { success: true, data: data as Payment[] };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function markPaymentPaid(
  taskId: string,
  paymentNote?: string
): Promise<ActionResponse<Payment>> {
  try {
    const profile = await requireAdmin();

    const supabase = await createClient();

    // Get or create payment record
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("*")
      .eq("task_id", taskId)
      .single();

    let payment: Payment;

    if (existingPayment) {
      const { data, error } = await supabase
        .from("payments")
        .update({
          paid_at: new Date().toISOString(),
          paid_by: profile.id,
          payment_note: paymentNote || null,
        })
        .eq("task_id", taskId)
        .select()
        .single();

      if (error) {
        return { success: false, error: "Failed to mark payment" };
      }
      payment = data as Payment;
    } else {
      // Get task to create payment record
      const { data: task } = await supabase
        .from("tasks")
        .select("payout_amount")
        .eq("id", taskId)
        .single();

      if (!task || task.payout_amount <= 0) {
        return { success: false, error: "Task has no payout amount" };
      }

      const { data, error } = await supabase
        .from("payments")
        .insert({
          task_id: taskId,
          amount: task.payout_amount,
          paid_at: new Date().toISOString(),
          paid_by: profile.id,
          payment_note: paymentNote || null,
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: "Failed to create payment" };
      }
      payment = data as Payment;
    }

    // Update task payment status
    await supabase
      .from("tasks")
      .update({ payment_status: "PAID" })
      .eq("id", taskId);

    // Get task details for notification
    const { data: taskData } = await supabase
      .from("tasks")
      .select("title, assigned_to")
      .eq("id", taskId)
      .single();

    // Create notification for employee
    if (taskData?.assigned_to) {
      await supabase.from("notifications").insert({
        user_id: taskData.assigned_to,
        type: "PAYMENT_PAID",
        title: "Payment recorded",
        message: `Payment of ₹${payment.amount} recorded for "${taskData.title}"`,
        reference_type: "task",
        reference_id: taskId,
      });
    }

    return { success: true, data: payment };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Get pending payment tasks for admin.
 */
export async function getPendingPaymentTasks(): Promise<
  ActionResponse<Array<{
    id: string;
    title: string;
    payout_amount: number;
    assigned_user: { full_name: string } | null;
  }>>
> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, payout_amount, assigned_user:profiles!tasks_assigned_to_fkey(full_name)")
      .eq("payment_status", "PENDING")
      .gt("payout_amount", 0)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: "Failed to load tasks" };
    }

    return { success: true, data: data as unknown as Array<{
      id: string;
      title: string;
      payout_amount: number;
      assigned_user: { full_name: string } | null;
    }> };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
