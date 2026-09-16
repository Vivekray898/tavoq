import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { AdminPaymentsView } from "@/components/payments/admin-payments-view";
import { EmployeePaymentsView } from "@/components/payments/employee-payments-view";

/**
 * §30/§70 — /payments is role-aware:
 *   Admin   → payout management workspace
 *   Employee→ personal earnings view
 */
export default async function PaymentsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.status !== "ACTIVE" || !profile.role) redirect("/pending");

  if (profile.role === "ADMIN") {
    return <AdminPaymentsView />;
  }
  return <EmployeePaymentsView />;
}
