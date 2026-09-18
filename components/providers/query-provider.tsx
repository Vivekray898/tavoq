"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * §2/§4 — client cache for every resource.
 *
 * Defaults: no refetch on window focus (that's what realtime is for),
 * no polling, retry once, garbage-collect 30 min after a query goes
 * unused. Reconnect refetch stays on as targeted recovery. Per-resource
 * staleTimes live next to each query in lib/queries/options.ts.
 */
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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
