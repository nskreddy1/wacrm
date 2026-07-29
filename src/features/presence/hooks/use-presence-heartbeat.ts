'use client';

import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/hooks/use-auth';
import {
  HEARTBEAT_MS,
  IDLE_AFTER_MS,
  type StoredPresence,
} from '@/features/presence/lib/presence';

/**
 * How long a tab may sit hidden AND idle before we stop heartbeating
 * altogether and let the row decay to offline.
 *
 * This is the single most important scale lever in this file. Long-lived
 * abandoned tabs are the common case in a CRM (people leave the dashboard
 * open for days), and heartbeating them forever would mean paying writes
 * for users who are not there — while also lying to their teammates, who
 * would see "online" for an empty chair. Shedding them is both cheaper and
 * more truthful.
 */
const ABANDON_AFTER_MS = 15 * 60_000;

/** Activity signals that count as "the human is still there". */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'focus',
] as const;

/**
 * Publishes the current user's presence heartbeat.
 *
 * Mount ONCE per app shell. Everything else in the presence feature only
 * ever reads (`usePresence`); this is the sole writer, so mounting it twice
 * would double the write rate for no benefit.
 *
 * Status is fully automatic, deliberately:
 *   - `online` — tab visible, or recent input
 *   - `away`   — hidden tab, or no input for IDLE_AFTER_MS
 *   - offline  — never written; viewers derive it from staleness, so a
 *                closed tab or crashed browser resolves correctly without
 *                depending on an unload write (which browsers routinely
 *                drop, especially on mobile).
 */
export function usePresenceHeartbeat(): void {
  const { user, accountId } = useAuth();
  const enabled = !!user?.id && !!accountId;

  // Held in refs: the heartbeat loop must see current values without
  // re-subscribing (a re-subscribe would reset the interval and, at scale,
  // turn every render into an extra write).
  const lastActivityRef = useRef(Date.now());
  const lastSentStatusRef = useRef<StoredPresence | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    /** Current status, or null when this tab should be shed entirely. */
    const resolveStatus = (): StoredPresence | null => {
      const idleFor = Date.now() - lastActivityRef.current;
      const hidden = document.visibilityState === 'hidden';

      // Hidden AND idle for a long stretch: stop reporting and let the
      // row go stale, so the member correctly reads as offline.
      if (hidden && idleFor > ABANDON_AFTER_MS) return null;
      if (hidden || idleFor > IDLE_AFTER_MS) return 'away';
      return 'online';
    };

    const send = async (status: StoredPresence) => {
      const { error } = await supabase.rpc('touch_presence', {
        p_status: status,
      });
      if (error) {
        // Never throw: a failed heartbeat is self-healing (the next tick
        // retries, and staleness makes the fallback state "offline",
        // which is the safe direction to fail in).
        console.error('[presence] heartbeat failed:', error.message);
        return;
      }
      lastSentStatusRef.current = status;
    };

    /**
     * Self-scheduling loop rather than setInterval: browsers throttle
     * timers in background tabs, and setInterval would queue up a burst
     * of catch-up writes the moment the tab is foregrounded again.
     */
    const tick = () => {
      if (cancelled) return;
      const status = resolveStatus();
      if (status) void send(status);
      timer = setTimeout(tick, HEARTBEAT_MS);
    };

    // Report immediately so the dot turns green on load rather than after
    // a full interval.
    tick();

    /**
     * Push an immediate update when the tab is shown or hidden, instead of
     * waiting up to HEARTBEAT_MS. This is what makes switching tabs feel
     * instant to teammates. Suppressed when the status has not actually
     * changed, so tab-flipping cannot be used to hammer the database.
     */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') markActive();
      const status = resolveStatus();
      if (status && status !== lastSentStatusRef.current) void send(status);
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, markActive, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, markActive);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `user.id` (not `user`) so a profile refresh doesn't restart the loop.
  }, [enabled, user?.id, accountId]);
}
