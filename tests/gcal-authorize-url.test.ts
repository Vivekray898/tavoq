import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizeParams,
  callbackRedirectUri,
  normalizeAppUrl,
} from "../lib/google/calendar.ts";

/**
 * The OAuth consent URL.
 *
 * access_type=offline and prompt=consent are the two parameters this
 * suite exists for. Both were present in the code, but nothing pinned
 * them: if either is dropped the callback still reports success, the
 * refresh token is simply never issued, and the sync dies an hour later
 * with nothing in the logs. This is the cheapest possible place to
 * catch that regression.
 */

const ARGS = {
  clientId: "client-abc.apps.googleusercontent.com",
  redirectUri: "https://task.creativoxa.com/api/auth/google/callback",
  scopes: [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar",
  ],
  state: "state-value",
};

describe("buildAuthorizeParams", () => {
  it("requests offline access", () => {
    assert.equal(buildAuthorizeParams(ARGS).get("access_type"), "offline");
  });

  it("forces the consent screen every time", () => {
    assert.equal(buildAuthorizeParams(ARGS).get("prompt"), "consent");
  });

  it("keeps previously granted scopes", () => {
    assert.equal(buildAuthorizeParams(ARGS).get("include_granted_scopes"), "true");
  });

  it("carries the full parameter set", () => {
    const p = buildAuthorizeParams(ARGS);
    assert.equal(p.get("client_id"), ARGS.clientId);
    assert.equal(p.get("redirect_uri"), ARGS.redirectUri);
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("state"), ARGS.state);
    assert.equal(p.get("scope"), ARGS.scopes.join(" "));
  });

  it("requests a writable calendar scope, not readonly", () => {
    // calendar.events.readonly is enough to read and then fail every
    // insert with a 403 that used to be invisible.
    const scope = buildAuthorizeParams(ARGS).get("scope") ?? "";
    assert.ok(scope.includes("auth/calendar.events"), "must request calendar.events");
    assert.ok(!scope.includes("readonly"), "must not request a readonly scope");
  });

  it("escapes the state rather than interpolating it raw", () => {
    const p = buildAuthorizeParams({ ...ARGS, state: "a b&c=d" });
    assert.equal(p.get("state"), "a b&c=d");
  });
});

describe("callbackRedirectUri", () => {
  it("appends the callback path to the app origin", () => {
    assert.equal(
      callbackRedirectUri("https://task.creativoxa.com"),
      "https://task.creativoxa.com/api/auth/google/callback"
    );
  });

  it("survives a trailing slash on the configured origin", () => {
    // A double slash here is a redirect_uri_mismatch in the Google
    // console, which fails at the token exchange with no hint.
    assert.equal(
      callbackRedirectUri("https://task.creativoxa.com/"),
      "https://task.creativoxa.com/api/auth/google/callback"
    );
    assert.equal(
      callbackRedirectUri("https://task.creativoxa.com///"),
      "https://task.creativoxa.com/api/auth/google/callback"
    );
  });
});

describe("normalizeAppUrl", () => {
  it("strips trailing slashes", () => {
    assert.equal(normalizeAppUrl("https://x.test/"), "https://x.test");
    assert.equal(normalizeAppUrl("https://x.test//"), "https://x.test");
  });

  it("leaves a clean URL untouched", () => {
    assert.equal(normalizeAppUrl("https://x.test"), "https://x.test");
  });

  it("falls back to localhost when unset", () => {
    assert.equal(normalizeAppUrl(undefined), "http://localhost:3000");
    assert.equal(normalizeAppUrl(""), "http://localhost:3000");
  });
});