"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  Menu,
  LogOut,
  User,
  ChevronDown,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

interface TopbarProps {
  profile: Profile;
  unreadCount?: number;
  onMenuToggle?: () => void;
}

export function Topbar({ profile, unreadCount = 0, onMenuToggle }: TopbarProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-background px-4 lg:px-6">
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={onMenuToggle}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "lg:hidden"
        )}
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex-1" />

      {/* Notifications — Link wraps an <a>, so we style it as a button via buttonVariants */}
      <Link
        href="/notifications"
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "relative"
        )}
        aria-label="Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>

      {/* User Menu — DropdownMenuTrigger itself is the button */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "flex items-center gap-2 px-2"
          )}
          aria-label="Open user menu"
        >
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {getInitials(profile.full_name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline text-sm font-medium">
            {profile.full_name}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => router.push("/profile")}>
            <User className="size-4 mr-2" />
            Profile
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Theme Switcher */}
          <DropdownMenuItem onClick={() => setTheme("light")}>
            <Sun className="size-4 mr-2" />
            Light
            {theme === "light" && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            <Moon className="size-4 mr-2" />
            Dark
            {theme === "dark" && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="size-4 mr-2" />
            System
            {theme === "system" && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="size-4 mr-2" />
            {isSigningOut ? "Signing out..." : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}