import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PublicHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-sm font-bold leading-none">T</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Taskora</span>
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/dashboard" />}>
            Go to dashboard
          </Button>
          <Button size="sm" render={<Link href="/login" />}>
            Sign in
          </Button>
        </div>
      </div>
    </header>
  );
}
