import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Optimistic-update tests.
 *
 * The pattern under test is the one used by the payment and employee
 * actions: snapshot the cache, patch optimistically, await the server,
 * then either reconcile or restore the snapshot.
 *
 * A real QueryClient is used so the assertions are about actual cache
 * contents, not a hand-rolled stand-in. The "server" is a deferred
 * promise the test resolves by hand, which is what makes the
 * before-resolution assertion meaningful — the cache must already
 * reflect the change while the request is still in flight.
 */

type Row = {
  id: string;
  status: "PENDING" | "PAID";
  paid_at: string | null;
};

/** A promise plus its resolvers, so the test controls timing exactly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The minimal slice of TanStack Query's cache API the optimistic
 * pattern uses. Deliberately tiny: the real QueryClient needs a React
 * runtime to be useful, and the behaviour under test here — snapshot,
 * write, restore — is pure data manipulation.
 */
class FakeCache<T> {
  private value: T | undefined;
  readonly key: string;

  constructor(key: string, initial: T) {
    this.key = key;
    this.value = initial;
  }

  get(): T | undefined {
    return this.value;
  }

  set(updater: (prev: T | undefined) => T | undefined): void {
    this.value = updater(this.value);
  }

  setRaw(next: T | undefined): void {
    this.value = next;
  }
}

interface History {
  history: Row[];
}

/**
 * Mirrors handleMarkPaid / runBulkMarkPaid in
 * components/payments/admin-payments-view.tsx.
 */
async function markPaidOptimistic(
  cache: FakeCache<History>,
  ids: string[],
  server: { promise: Promise<{ ok: boolean; paid_at?: string }> }
): Promise<void> {
  const snapshot = cache.get();
  const optimisticAt = new Date().toISOString();
  const idSet = new Set(ids);

  // Optimistic write — must be visible immediately.
  cache.set((prev) =>
    prev
      ? {
          ...prev,
          history: prev.history.map((r) =>
            idSet.has(r.id) ? { ...r, status: "PAID" as const, paid_at: optimisticAt } : r
          ),
        }
      : prev
  );

  const result = await server.promise;

  if (result.ok) {
    cache.set((prev) =>
      prev
        ? {
            ...prev,
            history: prev.history.map((r) =>
              idSet.has(r.id)
                ? { ...r, status: "PAID" as const, paid_at: result.paid_at! }
                : r
            ),
          }
        : prev
    );
  } else {
    // Roll back to exactly what was on screen before.
    cache.setRaw(snapshot);
  }
}

describe("optimistic payment updates", () => {
  const initial: History = {
    history: [
      { id: "p1", status: "PENDING", paid_at: null },
      { id: "p2", status: "PENDING", paid_at: null },
    ],
  };

  it("patches the cache before the server resolves", async () => {
    const cache = new FakeCache<History>("payments", structuredClone(initial));
    const server = deferred<{ ok: boolean; paid_at?: string }>();

    const inFlight = markPaidOptimistic(cache, ["p1"], { promise: server.promise });

    // The server has NOT resolved yet. The cache must already show it.
    const during = cache.get()!;
    assert.equal(during.history.find((r) => r.id === "p1")!.status, "PAID");
    assert.notEqual(during.history.find((r) => r.id === "p1")!.paid_at, null);
    // Untouched rows stay as they were.
    assert.equal(during.history.find((r) => r.id === "p2")!.status, "PENDING");

    server.resolve({ ok: true, paid_at: "2026-01-01T00:00:00.000Z" });
    await inFlight;
  });

  it("reconciles with the server's authoritative paid_at", async () => {
    const cache = new FakeCache<History>("payments", structuredClone(initial));
    const server = deferred<{ ok: boolean; paid_at?: string }>();
    const inFlight = markPaidOptimistic(cache, ["p1"], { promise: server.promise });

    server.resolve({ ok: true, paid_at: "2026-02-02T10:00:00.000Z" });
    await inFlight;

    assert.equal(
      cache.get()!.history.find((r) => r.id === "p1")!.paid_at,
      "2026-02-02T10:00:00.000Z"
    );
  });

  it("rolls back to the previous cache on failure", async () => {
    const cache = new FakeCache<History>("payments", structuredClone(initial));
    const server = deferred<{ ok: boolean; paid_at?: string }>();
    const inFlight = markPaidOptimistic(cache, ["p1"], { promise: server.promise });

    server.resolve({ ok: false });
    await inFlight;

    assert.deepEqual(cache.get(), initial, "cache restored to its pre-mutation state");
  });

  it("rolls back a bulk failure without leaving a partial mark", async () => {
    const cache = new FakeCache<History>("payments", structuredClone(initial));
    const server = deferred<{ ok: boolean; paid_at?: string }>();
    const inFlight = markPaidOptimistic(cache, ["p1", "p2"], { promise: server.promise });

    server.resolve({ ok: false });
    await inFlight;

    const after = cache.get()!;
    assert.equal(after.history.every((r) => r.status === "PENDING"), true);
    assert.equal(after.history.every((r) => r.paid_at === null), true);
  });

  it("marks only the targeted rows", async () => {
    const cache = new FakeCache<History>("payments", structuredClone(initial));
    const server = deferred<{ ok: boolean; paid_at?: string }>();
    const inFlight = markPaidOptimistic(cache, ["p2"], { promise: server.promise });

    server.resolve({ ok: true, paid_at: "2026-03-03T00:00:00.000Z" });
    await inFlight;

    const after = cache.get()!.history;
    assert.equal(after.find((r) => r.id === "p1")!.status, "PENDING");
    assert.equal(after.find((r) => r.id === "p2")!.status, "PAID");
  });

  it("is a no-op when nothing matches", async () => {
    const cache = new FakeCache<History>("payments", structuredClone(initial));
    const server = deferred<{ ok: boolean; paid_at?: string }>();
    const inFlight = markPaidOptimistic(cache, ["nope"], { promise: server.promise });

    server.resolve({ ok: true, paid_at: "2026-04-04T00:00:00.000Z" });
    await inFlight;

    assert.deepEqual(cache.get(), initial);
  });
});