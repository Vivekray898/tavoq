import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js middleware (proxy.ts in Next 16).
 *
 * Server-side gate for every protected route. A pending or suspended
 * user can never load the dashboard shell — no matter what URL they
 * type — even before any server component or RLS policy runs.
 *
 * Public routes: /login, /signup, /pending, /suspended, /invite/*,
 * /auth/*, /offline, /manifest.json, /icons/*, /sw.js and static assets.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/pending",
  "/suspended",
  "/invite",
  "/auth",
  "/offline",
  "/manifest.json",
  "/icons",
  "/sw.js",
  "/api/push",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshes the session cookies if needed
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in: protected routes go to login (with a return path)
  if (!user) {
    if (isPublic) return response;
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Signed in: load the profile's account state
  const { data: profile } = await supabase
    .from("profiles")
    .select("status, role")
    .eq("id", user.id)
    .single();

  const status = profile?.status as string | undefined;
  const role = profile?.role as string | null | undefined;

  // PENDING (or missing profile / no role yet): no application access.
  // Note: /pending itself must stay reachable so the user sees why.
  if (!profile || status !== "ACTIVE" || !role) {
    if (pathname === "/pending") return response;
    if (status === "SUSPENDED") {
      return NextResponse.redirect(new URL("/suspended", request.url));
    }
    return NextResponse.redirect(new URL("/pending", request.url));
  }

  // Active users shouldn't sit on the pending page
  if (pathname === "/pending" || pathname === "/suspended") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except Next internals and common static files.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|json|webmanifest|txt)$).*)",
  ],
};
