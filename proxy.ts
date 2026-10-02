import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";

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

/**
 * Local ES256 JWT verification (asymmetric signing keys — the project's
 * Supabase auth already issues ES256 tokens; verified against the
 * project JWKS). Lets the gate run with ZERO Supabase round-trips on
 * warm requests: no /auth/v1/user, no extra profiles query, no
 * cross-region latency on the critical path of every navigation.
 *
 * The payload is returned unverified if no JWKS is reachable so the
 * fallback path (full Supabase check) can take over.
 */
async function readJwtClaims(
  request: NextRequest
): Promise<{ sub: string; role?: string } | null> {
  const tokenName = `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL!.match(
    /https:\/\/([a-z0-9]+)\.supabase\.co/
  )?.[1]}-auth-token`;
  const rawCookie = request.cookies.get(tokenName)?.value;
  if (!rawCookie) return null;

  let accessToken: string | undefined;
  try {
    const decoded = rawCookie.startsWith("base64-")
      ? atob(rawCookie.slice("base64-".length))
      : rawCookie;
    const parsed = JSON.parse(decoded) as { access_token?: string };
    accessToken = parsed.access_token;
  } catch {
    return null;
  }
  if (!accessToken) return null;

  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(
      atob(headerB64.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { alg?: string; kid?: string };
  } catch {
    return null;
  }
  if (header.alg !== "ES256" || !header.kid) return null; // symmetric keys → fallback

  try {
    const jwksResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      { next: { revalidate: 3600 }, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } }
    );
    if (!jwksResponse.ok) return null;
    const jwks = (await jwksResponse.json()) as {
      keys: Array<{ kid: string; kty: string; crv: string; x: string; y: string }>;
    };

    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const message = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = new Uint8Array(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => c.charCodeAt(0))
    );

    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      key,
      signature,
      message
    );
    if (!ok) return null;

    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { sub?: string; role?: string; exp?: number };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  let response = NextResponse.next({ request });

  // ── Fast path: verify the session JWT locally (no Supabase calls) ──
  const claims = await readJwtClaims(request);

  if (claims) {
    const profileResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=status,role&id=eq.${claims.sub}`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          Accept: "application/json",
        },
        // Short cache: status changes are rare, and the dashboard layout
        // + every server action still enforce status on every request,
        // so a ≤30s-old status here only ever means the fast pre-gate
        // lets a just-suspended user one page further before the hard
        // gate catches them.
        next: { revalidate: 30, tags: [`profile-status-${claims.sub}`] },
      }
    );

    let status: string | undefined;
    let role: string | null | undefined;
    if (profileResponse.ok) {
      const rows = (await profileResponse.json()) as Array<{
        status: string;
        role: string | null;
      }>;
      status = rows[0]?.status;
      role = rows[0]?.role ?? null;
    }

    if (status === "ACTIVE" && role) {
      // Active users shouldn't sit on the pending/suspended pages —
      // same bounce the legacy path applies below.
      if (pathname === "/pending" || pathname === "/suspended") {
        return NextResponse.redirect(new URL("/", request.url));
      }
      // Fully verified active user — straight through.
      return response;
    }

    if (status || role) {
      // Known profile but pending/suspended → exact same routing the
      // legacy path produced.
      if (pathname === "/pending") return response;
      if (status === "SUSPENDED") {
        return NextResponse.redirect(new URL("/suspended", request.url));
      }
      return NextResponse.redirect(new URL("/pending", request.url));
    }
    // No visible profile row → fall through to the legacy Supabase path
    // so edge cases (RLS timing, brand-new signups) resolve exactly as
    // they did before.
  }

  // ── Legacy path (identical behavior, unchanged) ──
  const cookieSnapshot = request.cookies.getAll();
  const cookieAdapter: CookieMethodsServer = {
    getAll() {
      // Fixed snapshot — the proxy never mutates cookies mid-request, so
      // a re-read could never observe anything new anyway.
      return cookieSnapshot;
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
  };
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieAdapter }
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

  // PENDING (or missing profile / no role): no application access.
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
