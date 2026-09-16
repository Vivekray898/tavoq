import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/auth";
import { PaymentsView } from "@/components/payments/payments-view";

export default async function PaymentsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ADMIN") redirect("/profile");

  return <PaymentsView />;
}
