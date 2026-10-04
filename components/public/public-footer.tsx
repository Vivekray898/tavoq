import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/constants";

/**
 * Public footer. Only contains links to other public routes — /dashboard,
 * /tasks, /calendar, /projects, /clients, /employees, /payments, /settings,
 * /profile, /notifications, /admin, /settings, /employee, /login, /signup,
 * /pending, /suspended, /invite/*, /auth/*, /offline, /manifest.json, /sw.js,
 * /serwist/*, /icons/*, /api, /serwist/[path].
 *
 * The Privacy Policy and Terms of Service are the ONLY public legal links;
 * they are reachable with no authentication.
 */
export function PublicFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-4xl px-4 pb-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-sm font-bold leading-none">T</span>
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Taskora</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Support: {SUPPORT_EMAIL}
          </p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
        </nav>
      </div>
    </footer>
  );
}
