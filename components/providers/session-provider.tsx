"use client";

import { createContext, useContext } from "react";
import type { Profile, UserRole } from "@/types/database";

export type SessionProfile = Profile & { role: NonNullable<Profile["role"]> };

interface SessionContextValue {
  profile: SessionProfile;
  userId: string;
  role: UserRole;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The dashboard layout already loads the full profile once (server-side,
 * persists across child navigations). Share it instead of having every
 * client page re-run `auth.getUser()` + a `profiles` query on mount.
 */
export function SessionProvider({
  profile,
  children,
}: {
  profile: SessionProfile;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider
      value={{ profile, userId: profile.id, role: profile.role }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
