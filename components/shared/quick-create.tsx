"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckSquare, FolderKanban, Building2, IndianRupee, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/components/providers/session-provider";
import { cn } from "@/lib/utils";

/**
 * §2 — global quick-create. Reuses the existing pages/forms (no duplicate
 * forms); Payment routes to the dedicated Payments workflow. Admin-only.
 */
export function QuickCreate() {
  const router = useRouter();
  const { role } = useSession();
  const [open, setOpen] = useState(false);
  const isAdmin = role === "ADMIN";

  if (!isAdmin) return null;

  const items = [
    { label: "Task", icon: CheckSquare, href: "/tasks/new" },
    { label: "Project", icon: FolderKanban, href: "/projects/new" },
    { label: "Client", icon: Building2, href: "/clients/new" },
    { label: "Payment", icon: IndianRupee, href: "/payments", payment: true },
  ];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
        aria-label="Quick create"
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">Create</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onClick={() => {
              setOpen(false);
              if (item.payment) {
                // Dedicated payments workflow — the workspace owns creation.
                router.push(item.href);
                window.dispatchEvent(
                  new CustomEvent("taskora-payments-intent", { detail: "create" })
                );
              } else {
                router.push(item.href);
              }
            }}
          >
            <item.icon className="mr-1 size-4 text-muted-foreground" />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobile FAB variant — fixed above the bottom nav on small screens. */
export function MobileQuickCreate() {
  const { role } = useSession();
  const isAdmin = role === "ADMIN";
  if (!isAdmin) return null;

  return (
    <Link
      href="/tasks/new"
      aria-label="Create task"
      className={cn(
        buttonVariants({ size: "icon" }),
        "fixed bottom-20 right-4 z-40 size-12 rounded-full shadow-lg lg:hidden"
      )}
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <Plus className="size-5" />
    </Link>
  );
}
