import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found — Taskora" };

/**
 * Phase 1 — App Router renders its built-in 404 for unmatched routes when no
 * app/not-found.tsx exists. This gives a branded page with a way back into the
 * app instead.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have been
        moved.
      </p>
      <Button render={<Link href="/" />} className="mt-6">
        Back to dashboard
      </Button>
    </div>
  );
}