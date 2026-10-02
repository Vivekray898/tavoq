import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Part B — hardening.
 *
 * Each item asserts a property that must hold. Where the code already
 * satisfies it, the test is the deliverable: a regression guard rather
 * than a change.
 */

const REALTIME = readFileSync(
  "components/providers/realtime-provider.tsx",
  "utf8"
);
const QUERY_PROVIDER = readFileSync(
  "components/providers/query-provider.tsx",
  "utf8"
);
const SESSION_PROVIDER = readFileSync(
  "components/providers/session-provider.tsx",
  "utf8"
);

describe("realtime resilience", () => {
  it("refetches on reconnect but not on window focus", () => {
    // Realtime is the source of truth for freshness; a focus refetch
    // would be redundant traffic on every tab switch.
    assert.match(QUERY_PROVIDER, /refetchOnWindowFocus:\s*false/);
    assert.match(QUERY_PROVIDER, /refetchOnReconnect:\s*true/);
  });

  it("never polls as a substitute for realtime", () => {
    assert.equal(/refetchInterval/.test(REALTIME), false);
    assert.equal(/refetchInterval/.test(QUERY_PROVIDER), false);
  });

  it("never calls router.refresh()", () => {
    assert.equal(
      /router\.refresh\(/.test(REALTIME),
      false,
      "a full refresh defeats the cache patching"
    );
  });

  it("opens exactly one channel and tears it down on unmount", () => {
    // Duplicate channels on route changes are the classic realtime
    // leak: every navigation adds another socket and every event is
    // handled N times.
    const channels = REALTIME.match(/\.channel\(/g) ?? [];
    assert.equal(
      channels.length,
      1,
      `expected exactly one channel, found ${channels.length}`
    );
    assert.match(
      REALTIME,
      /removeChannel/,
      "the channel must be removed when the effect cleans up"
    );
  });

  it("reconnects and re-syncs without a full reload", () => {
    // Supabase Realtime auto-reconnects; the provider's job on a
    // re-SUBSCRIBE is to catch up the visible queries only.
    assert.match(REALTIME, /everConnected/);
    assert.match(
      REALTIME,
      /invalidateQueries\(\{\s*refetchType:\s*"active"\s*\}\)/,
      "reconnect must target only the active queries"
    );
  });

  it("scopes reconnect recovery to active queries everywhere", () => {
    // A bare invalidateQueries() would refetch every cached query in the
    // app — including screens the user is not looking at.
    const bare = REALTIME.match(/invalidateQueries\(\s*\{[^}]*\}\s*\)/g) ?? [];
    for (const call of bare) {
      assert.ok(
        call.includes("refetchType"),
        `unscoped invalidation would refetch the whole app: ${call}`
      );
    }
  });
});

describe("role change propagates live", () => {
  it("patches the session profile when the signed-in user's role changes", () => {
    // Without this, a promoted user keeps seeing the old nav until they
    // sign out and back in.
    assert.match(
      REALTIME,
      /id\s*===\s*authUserId/,
      "the profiles handler must detect a change to the signed-in user"
    );
  });

  it("the session provider exposes a mutable role", () => {
    // The role has to be re-renderable, not frozen at mount.
    assert.match(SESSION_PROVIDER, /role:\s*profile\.role/);
  });
});

describe("optimistic update hygiene", () => {
  const PAYMENTS = readFileSync(
    "components/payments/admin-payments-view.tsx",
    "utf8"
  );
  const EMPLOYEES = readFileSync(
    "components/employees/employees-list.tsx",
    "utf8"
  );

  it("payments snapshot before patching and restore on failure", () => {
    assert.match(PAYMENTS, /getQueryData<PaymentWorkspaceData>/);
    assert.match(PAYMENTS, /setQueryData\(qk\.paymentWorkspace\(\),\s*snapshot\)/);
  });

  it("employees snapshot before patching and restore on failure", () => {
    assert.match(EMPLOYEES, /queryClient\.setQueryData\(teamMembersOptions\.queryKey,\s*snapshot\)/);
  });

  it("every rollback path surfaces a toast", () => {
    // A silent rollback is worse than no optimistic update: the UI
    // changes back with no explanation.
    //
    // Checked per-rollback rather than per-file: an earlier version
    // only asserted that "toast.error" appeared somewhere in the file,
    // which one unrelated handler would satisfy.
    const rollbacks = [
      ["payments", PAYMENTS],
      ["employees", EMPLOYEES],
    ] as const;

    for (const [name, src] of rollbacks) {
      const lines = src.split("\n");
      const sites = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /setQueryData\([\s\S]*?snapshot\s*\)/.test(line));

      assert.ok(sites.length > 0, `${name}: expected at least one rollback`);

      for (const { i } of sites) {
        // The toast must appear within the same handler, shortly after
        // the restore — not somewhere else in the file.
        const window = lines.slice(i, i + 4).join("\n");
        assert.match(
          window,
          /toast\.error/,
          `${name}: the rollback at line ${i + 1} has no toast.error within 3 lines`
        );
      }
    }
  });

  it("reconciles with the server's value after a successful optimistic write", () => {
    assert.match(PAYMENTS, /paid_at:\s*result\.data\.paid_at/);
  });
});

describe("server action error surfaces", () => {
  /**
   * Every `{ success: false }` must carry a readable message. A bare
   * `{ success: false }` renders an empty toast, which tells the user
   * nothing about why nothing happened.
   */
  const ACTION_FILES = readdirSync("lib/actions").filter((f) =>
    f.endsWith(".ts")
  );

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (full.endsWith(".tsx") || full.endsWith(".ts")) yield full;
    }
  }

  it("no server action returns success:false without an error message", () => {
    const offenders: string[] = [];

    for (const file of ACTION_FILES) {
      const src = readFileSync(join("lib/actions", file), "utf8");
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

      // Only a genuinely bare `{ success: false }` is a defect. A
      // regex of /success:\s*false\s*[,}]/ would also match the prefix
      // of a perfectly good `{ success: false, error: "..." }`, so the
      // closing brace is required here — no comma, no error field.
      const bare = code.match(/\{\s*success:\s*false\s*\}/g) ?? [];
      if (bare.length > 0) offenders.push(`${file} (${bare.length})`);
    }

    assert.deepEqual(
      offenders,
      [],
      `these files return { success: false } with no error message:\n  ${offenders.join(
        "\n  "
      )}`
    );
  });

  it("no component swallows a failed action silently", () => {
    // A `catch {}` around a mutation hides every failure.
    const offenders: string[] = [];
    for (const file of walk("components")) {
      const src = readFileSync(file, "utf8");
      if (/catch\s*\{\s*\}/.test(src) && /Action|action/.test(src)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `silent catch blocks: ${offenders.join(", ")}`);
  });
});