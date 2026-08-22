/**
 * Realtime facade (plan Task 6, ADR-INFRA-001 §6, Dependency Rule §A).
 *
 * ALL feature code subscribes to realtime through this module — never
 * by importing the Supabase client and calling `.channel()` directly
 * (enforced by check:architecture ARCH-006). The point is vendor
 * confinement: Supabase Realtime is priced per concurrent connection
 * and per message; if cost or reliability ever forces a move (e.g. to
 * Cloudflare Durable Objects WebSockets), the swap happens HERE, in
 * one file, not across every feature hook.
 *
 * DELIBERATE SHAPE (recorded in the execution log): the plan sketched
 * `subscribe(channel, handler): Unsubscribe`, but the four existing
 * call sites use three DIFFERENT Supabase primitives — postgres_changes,
 * presence (track/sync), and broadcast. Flattening those into one
 * handler signature would either lose capability or reimplement the
 * vendor API badly. Instead the facade exposes the channel object
 * itself while keeping the VENDOR IMPORT confined; call sites depend
 * on `@/lib/realtime`, and the re-exported types are the seam a future
 * adapter must satisfy.
 */
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type { RealtimeChannel };

/**
 * Get (or create) the named realtime channel. Supabase returns the
 * already-registered channel instance for a topic it knows — callers
 * relying on that dedupe behavior (presence) keep working.
 */
export function getChannel(
  topic: string,
  opts?: { presenceKey?: string; isPrivate?: boolean }
): RealtimeChannel {
  const supabase = createClient();
  return supabase.channel(topic, {
    config: {
      ...(opts?.presenceKey ? { presence: { key: opts.presenceKey } } : {}),
      ...(opts?.isPrivate !== undefined ? { private: opts.isPrivate } : {}),
    },
  });
}

/** Tear down a channel and its socket subscription. */
export function removeChannel(channel: RealtimeChannel): void {
  const supabase = createClient();
  void supabase.removeChannel(channel);
}
