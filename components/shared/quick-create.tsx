"use client";

import { useState } from "react";
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
  const isAdmin = role === "SUPER_ADMIN";

  if (!isAdmin) return null;

  const items = [
    { label: "Task", icon: CheckSquare, href: "/tasks/new" },
    { label: "Project", icon: FolderKanban, href: "/projects/new" },
    { label: "Client", icon: Building2, href: "/clients/new" },
    { label: "Payment", icon: IndianRupee, href: "/payments" },
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
              // Payment routes to the dedicated Payments workflow;
              // everything else to its existing create page.
              router.push(item.href);
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
