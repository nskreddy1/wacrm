'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * SSR-safe boolean preference persisted in localStorage.
 *
 * Built on useSyncExternalStore so:
 * - the server snapshot always renders `defaultValue` (no hydration
 *   mismatch when the stored value differs),
 * - the client snapshot reads localStorage synchronously after
 *   hydration (no post-mount setState flash pass),
 * - updates from OTHER tabs propagate via the `storage` event.
 *
 * localStorage reads/writes are wrapped in try/catch: both can throw in
 * private-browsing / sandboxed contexts, where the hook degrades to a
 * plain in-memory default.
 */
export function useLocalStorageBoolean(key: string, defaultValue: boolean) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) onStoreChange();
      };
      // Same-tab writes don't fire `storage`; useLocalStorageBoolean
      // dispatches this custom event from its setter instead.
      const onLocal = (event: Event) => {
        if ((event as CustomEvent<string>).detail === key) onStoreChange();
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener('local-storage-state', onLocal);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('local-storage-state', onLocal);
      };
    },
    [key]
  );

  const getSnapshot = useCallback(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : stored === 'true';
    } catch {
      return defaultValue;
    }
  }, [key, defaultValue]);

  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultValue
  );

  const setValue = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      try {
        const prev = (() => {
          try {
            const stored = localStorage.getItem(key);
            return stored === null ? defaultValue : stored === 'true';
          } catch {
            return defaultValue;
          }
        })();
        const resolved = typeof next === 'function' ? next(prev) : next;
        localStorage.setItem(key, String(resolved));
        window.dispatchEvent(
          new CustomEvent('local-storage-state', { detail: key })
        );
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
    },
    [key, defaultValue]
  );

  return [value, setValue] as const;
}
