import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Realtime consistency tests.
 *
 * ── What this deliberately does NOT do ────────────────────────
 *
 * An earlier draft of this file inserted probe rows into the live
 * database to prove events were delivered. That was wrong: the
 * database under test is a real project with real users, and writing
 * throwaway rows into it to satisfy a test is a side effect nobody
 * asked for. (It also failed, on a foreign key.)
 *
 * So this suite is READ-ONLY. It proves what can be proven without
 * writing: that the provider and the publication migration agree, that
 * every subscribed table is named in the migration, and that a
 * subscription channel can be established at all.
 *
 * End-to-end delivery ("A's change reaches B in ~1s") is verified by
 * the manual checklist in docs/realtime-qa.md, which uses real user
 * actions rather than synthetic writes.
 */

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

const dbAvailable = Boolean(URL && KEY);
const TIMEOUT_MS = 8000;

describe("realtime publication", () => {
  if (!dbAvailable) {
    it("is skipped: no Supabase instance configured", () => {
      assert.equal(dbAvailable, false);
    });
    return;
  }

  let reachable = false;
  let reader: { removeAllChannels: () => Promise<unknown> } | null = null;

  before(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(URL as string, KEY as string, {
      auth: { persistSession: false },
    });
    reader = client as unknown as { removeAllChannels: () => Promise<unknown> };

    // A subscription reaching SUBSCRIBED proves the realtime socket
    // and the project's realtime configuration are working. It does
    // NOT prove a table is published — that needs a real write.
    reachable = await new Promise<boolean>((resolve) => {
      client
        .channel("probe-publication")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks" },
          () => {}
        )
        .subscribe((status) => resolve(status === "SUBSCRIBED"));
      setTimeout(() => resolve(false), TIMEOUT_MS);
    });
  });

  after(async () => {
    await reader?.removeAllChannels?.();
  });

  it("can establish a realtime subscription", () => {
    assert.equal(
      reachable,
      true,
      reachable
        ? undefined
        : "could not SUBSCRIBE — check that realtime is enabled for this project"
    );
  });
});

describe("provider and publication migration agree", () => {
  const provider = readFileSync(
    "components/providers/realtime-provider.tsx",
    "utf8"
  );
  const migration = readFileSync(
    "supabase/migrations/015_realtime_publication.sql",
    "utf8"
  );

  const SUBSCRIBED = [
    ...new Set([...provider.matchAll(/table:\s*"([a-z_]+)"/g)].map((m) => m[1])),
  ];

  it("the provider subscribes to the expected tables", () => {
    // Guards the set itself, so a silent removal is caught.
    for (const table of [
      "tasks",
      "task_comments",
      "payments",
      "notifications",
      "activity",
      "profiles",
      "project_members",
      "project_resources",
      "task_subtasks",
    ]) {
      assert.ok(
        SUBSCRIBED.includes(table),
        `${table} should be subscribed by the realtime provider`
      );
    }
  });

  it("every subscribed table is published by migration 015", () => {
    for (const table of SUBSCRIBED) {
      assert.ok(
        migration.includes(`'${table}'`),
        `${table} is subscribed by the provider but missing from migration 015 — ` +
          `it would never fire without being in the supabase_realtime publication`
      );
    }
  });

  it("migration 015 publishes nothing the provider ignores", () => {
    const published = [
      ...new Set(
        [...migration.matchAll(/^\s*'([a-z_]+)',?\s*$/gm)].map((m) => m[1])
      ),
    ].filter((t) => !["supabase_realtime"].includes(t));

    for (const table of published) {
      assert.ok(
        SUBSCRIBED.includes(table),
        `migration 015 publishes ${table} but no handler subscribes to it`
      );
    }
  });

  it("uses no polling or router.refresh as a realtime substitute", () => {
    assert.equal(
      /refetchInterval/.test(provider),
      false,
      "polling is not a substitute for realtime"
    );
    assert.equal(
      /router\.refresh\(/.test(provider),
      false,
      "router.refresh() forces a full reload and defeats the cache patching"
    );
  });

  it("prefers surgical patches over blanket invalidation", () => {
    // The provider should write to specific caches, not invalidate
    // everything on every event.
    assert.ok(
      /setQueryData|setQueriesData/.test(provider),
      "expected the provider to patch caches directly"
    );
  });
});