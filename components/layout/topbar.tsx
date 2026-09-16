"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, LogOut, Search, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SearchDialog } from "@/components/shared/search-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

interface TopbarProps {
  profile: Profile;
}

export function Topbar({ profile }: TopbarProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 hidden h-14 items-center gap-3 border-b bg-background/95 px-6 backdrop-blur lg:flex">
      {/* Search trigger */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "h-8 w-64 justify-start gap-2 text-muted-foreground"
        )}
      >
        <Search className="size-3.5" />
        <span className="text-[13px]">Search…</span>
        <kbd className="pointer-events-none ml-auto rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1" />

      {/* Notifications */}
      <Link
        href="/notifications"
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
        aria-label="Notifications"
      >
        <Bell className="size-4.5" strokeWidth={1.8} />
      </Link>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "flex items-center gap-2 px-2"
          )}
          aria-label="Open user menu"
        >
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">
              {getInitials(profile.full_name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{profile.full_name}</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => router.push("/profile")}>
            <User className="size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="size-4" />
            {isSigningOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
