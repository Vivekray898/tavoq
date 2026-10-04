import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { SkeletonList } from "@/components/shared/skeleton-loader";
import { AdminPaymentsView } from "@/components/payments/admin-payments-view";
import { EmployeePaymentsView } from "@/components/payments/employee-payments-view";

/**
 * §30/§70 — /payments is role-aware:
 *   Staff (SUPER_ADMIN or MANAGER) → payout management workspace
 *   Employee                       → personal earnings view
 *
 * Migration 014 grants payments management to BOTH tiers
 * ("Active staff manages payments"), so the workspace belongs to
 * managers too — they are operational staff, not a lesser admin. The
 * page previously showed it to super admins only, which left managers
 * with a read-only earnings view while the RLS let them do everything.
 */
export default async function PaymentsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.status !== "ACTIVE" || !profile.role) redirect("/pending");

  if (isStaff(profile.role)) {
    // AdminPaymentsView reads the filter state from the URL so a filtered
    // view can be shared and restored. useSearchParams needs a Suspense
    // boundary above it, or the whole route opts out of static rendering
    // and fails the build with "useSearchParams() should be wrapped in a
    // suspense boundary".
    return (
      <Suspense fallback={<SkeletonList rows={6} />}>
        <AdminPaymentsView />
      </Suspense>
    );
  }
  return <EmployeePaymentsView />;
}