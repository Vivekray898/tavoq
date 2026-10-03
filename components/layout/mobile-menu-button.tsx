"use client";

import { usePathname } from "next/navigation";
import { MenuButton } from "@/components/layout/mobile-header";

/**
 * Floating hamburger for the pages that render their own header.
 *
 * MobileHeader deliberately returns null on the dashboard and on detail
 * pages, because those screens draw their own title block and a
 * back-affordance. That would otherwise leave them — the two most visited
 * screens — with no way to open the drawer once the bottom bar is gone.
 *
 * So this sits on top of them instead: fixed, top-left, below lg only, and
 * inset for the notch. It is inert on every other route, where
 * MobileHeader's own hamburger already shows.
 */
export function MobileMenuButton({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();

  const isDetail =
    /^\/(tasks|projects|clients|employees)\/[^/]+$/.test(pathname) ||
    /^\/(tasks|projects|clients|employees)\/[^/]+\/edit$/.test(pathname);

  if (pathname !== "/" && !isDetail) return null;

  return (
    <div
      className="fixed left-2 z-30 lg:hidden"
      style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      <MenuButton onClick={onMenuClick} />
    </div>
  );
}