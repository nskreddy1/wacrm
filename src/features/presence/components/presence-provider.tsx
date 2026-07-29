'use client';

import { createContext, useContext } from 'react';

import { usePresenceHeartbeat } from '@/features/presence/hooks/use-presence-heartbeat';
import type { StoredPresence } from '@/features/presence/lib/presence';

/**
 * Self presence. Defaults to 'online' so a component rendered outside the
 * provider degrades to the common case rather than throwing — the dot is
 * decoration, never a correctness boundary.
 */
const SelfPresenceContext = createContext<StoredPresence>('online');

/**
 * Runs the app's single presence writer and publishes the status it is
 * currently reporting.
 *
 * `children` is passed straight through, so when the status flips the
 * provider re-renders but the dashboard subtree does not — React bails
 * out on the unchanged element. Only `useSelfPresence()` consumers update.
 *
 * Mount exactly once, inside AuthProvider.
 */
export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const selfStatus = usePresenceHeartbeat();
  return (
    <SelfPresenceContext.Provider value={selfStatus}>
      {children}
    </SelfPresenceContext.Provider>
  );
}

/**
 * The status this session is publishing to teammates — 'online' or
 * 'away'. Never 'offline': by definition you are here if you are asking.
 */
export function useSelfPresence(): StoredPresence {
  return useContext(SelfPresenceContext);
}
