"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  persistQueryClientSubscribe,
} from "@tanstack/query-persist-client-core";
import type {
  PersistQueryClientOptions,
  Persister,
  PersistedClient,
} from "@tanstack/query-persist-client-core";

/**
 * §2/§4 — client cache for every resource.
 *
 * Defaults: no refetch on window focus (that's what realtime is for),
 * no polling, retry once, garbage-collect 30 min after a query goes
 * unused. Reconnect refetch stays on as targeted recovery. Per-resource
 * staleTimes live next to each query in lib/queries/options.ts.
 */

/**
 * Allowlist for the localStorage persistence layer (§37): only safe,
 * non-sensitive workspace data survives a reload. Never persisted:
 * anything auth-shaped, payment amounts, employee emails, activity
 * rows, dashboard aggregates. If a key is not listed here it simply
 * does not persist — the default for anything added later.
 */
const PERSISTABLE_KEY_PREFIXES = [
  ["tasks"],
  ["projects"],
  ["clients"],
  ["labels"],
  ["saved-filters"],
  ["notifications"],
] as const;

function isPersistableQueryKey(key: readonly unknown[]): boolean {
  return PERSISTABLE_KEY_PREFIXES.some((prefix) =>
    prefix.every((part, i) => key[i] === part)
  );
}

/** Bump to drop every persisted payload after a breaking data change. */
const PERSIST_BUSTER = `taskora-v1`;
/** 24h — kept well below the 30 min per-query gcTime. */
const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

const STORAGE_KEY = "taskora-query-cache";

function getSupabaseRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
}

/**
 * Synchronous, network-free identity for the persistence owner check:
 * the browser session cookie (set by @supabase/ssr) carries the user
 * id. Trusted ONLY for "is this cache mine" UX decisions — never for
 * authorization, which stays server-side everywhere.
 */
function readSessionUserId(): string | null {
  const ref = getSupabaseRef();
  if (!ref || typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`sb-${ref}-auth-token=`))
    ?.split("=")
    .slice(1)
    .join("=");
  if (!raw) return null;
  try {
    const json = raw.startsWith("base64-")
      ? atob(raw.slice("base64-".length))
      : decodeURIComponent(raw);
    const session = JSON.parse(json) as { user?: { id?: string } };
    return session.user?.id ?? null;
  } catch {
    return null;
  }
}

interface OwnedPersistedState {
  owner: string | null;
  state: unknown;
}

function createLocalStoragePersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        const payload: OwnedPersistedState = {
          owner: readSessionUserId(),
          state: client,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Quota exceeded / private mode — persistence is best-effort.
      }
    },
    restoreClient: async (): Promise<PersistedClient | undefined> => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return undefined;
        const stored = JSON.parse(raw) as OwnedPersistedState;
        // Shared-device safety: only restore rows that belong to the
        // session's own user. Anything else is wiped, not reused.
        if (stored.owner !== readSessionUserId()) {
          window.localStorage.removeItem(STORAGE_KEY);
          return undefined;
        }
        return stored.state as PersistedClient;
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    },
  };
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 30 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      })
  );

  /**
   * Persistence wiring — same contract as PersistQueryClientProvider,
   * mounted inline so the provider tree stays untouched. Restore runs
   * before the dashboard's queries mount, so a reload paints cached
   * rows instantly and revalidates in the background; saving
   * subscribes to cache changes.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
      persister: createLocalStoragePersister(),
      buster: PERSIST_BUSTER,
      maxAge: PERSIST_MAX_AGE,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" && isPersistableQueryKey(query.queryKey),
      },
    };

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { persistQueryClientRestore } = await import(
          "@tanstack/query-persist-client-core"
        );
        if (cancelled) return;
        await persistQueryClientRestore({ queryClient, ...persistOptions });
        if (cancelled) return;
        unsubscribe = persistQueryClientSubscribe({
          queryClient,
          ...persistOptions,
        });      } catch {
        // Persistence is best-effort; the app works fully without it.
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
