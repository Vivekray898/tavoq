import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A one-time OAuth authorization code must only ever be spent once.
 *
 * The browser reaches /auth/callback more than once for a single
 * sign-in: a refresh, a back/forward navigation, a restored tab, or a
 * prefetch. Supabase's exchangeCodeForSession is one-shot, so the second
 * attempt fails with an opaque "Invalid Refresh Token" / "already used"
 * error and the user is bounced to /login EVEN THOUGH the first attempt
 * already signed them in — a self-inflicted version of the redirect
 * loop this repo already fixed once.
 *
 * The callback must therefore skip the exchange when a session already
 * exists. These tests pin that ordering, because it is invisible at
 * runtime: nothing breaks until a user hits refresh on the callback.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** Strip comments so prose cannot satisfy a structural assertion. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const callback = strip(read("../app/(auth)/auth/callback/route.ts"));

describe("/auth/callback is a route handler with a single exchange site", () => {
  test("never runs auth logic on the client", () => {
    const raw = read("../app/(auth)/auth/callback/route.ts");
    assert.doesNotMatch(raw, /^\s*"use client"/m);
    assert.doesNotMatch(raw, /^\s*"use server"/m);
  });

  test("exports exactly one GET handler", () => {
    assert.match(callback, /export async function GET\(/);
    assert.doesNotMatch(callback, /export async function POST\(/);
  });

  test("calls exchangeCodeForSession exactly once", () => {
    const calls = [...callback.matchAll(/exchangeCodeForSession\(/g)];
    assert.equal(calls.length, 1, "a second exchange site is a second code spend");
  });
});

describe("an existing session short-circuits the code exchange", () => {
  // The guard must come BEFORE the exchange, and must return.
  const sessionAt = callback.indexOf("auth.getUser()");
  const exchangeAt = callback.indexOf("exchangeCodeForSession(");

  test("checks for a session before spending the code", () => {
    assert.ok(sessionAt > -1, "the callback must look for an existing session");
    assert.ok(exchangeAt > -1, "the callback must still be able to exchange a code");
    assert.ok(
      sessionAt < exchangeAt,
      "the existing-session guard must come first, or a replayed code is still spent",
    );
  });

  test("the guard is inside an early return, not a soft hint", () => {
    // ...auth.getUser() is followed by an early `return` that redirects,
    // before the code branch begins.
    const afterGuard = callback.slice(sessionAt);
    const codeBranch = afterGuard.indexOf("if (code)");
    const guardBody = afterGuard.slice(0, codeBranch > -1 ? codeBranch : undefined);
    assert.match(guardBody, /return\s+NextResponse\.redirect\(/);
    assert.doesNotMatch(
      guardBody,
      /if\s*\(\s*existing\.user\s*\)\s*\{\s*\}/,
      "an empty guard would fall through and spend the code anyway",
    );
  });

  test("still routes the signed-in user on the shared table", () => {
    assert.match(callback, /destinationFor\(/);
    assert.match(callback, /getAccountDestination\(profile \?\? null\)/);
  });
});

describe("failures stay legible instead of collapsing into one string", () => {
  test("surfaces the provider's own error message", () => {
    assert.match(
      callback,
      /Google sign-in failed: \$\{error\.message\}/,
      "a generic message hides expired-code vs already-registered, which need different fixes",
    );
  });

  test("keeps the already-registered guidance", () => {
    assert.match(callback, /error\.message\.includes\("already"\)/);
    assert.match(callback, /automatic account linking/);
  });

  test("awaits the server client before using it", () => {
    // createClient() returns a Promise in this codebase; an un-awaited
    // use is a runtime TypeError, not a type error the compiler catches
    // when the call is spread across lines.
    assert.doesNotMatch(callback, /await createClient\(\)\.(auth|from)\b/);
  });
});
