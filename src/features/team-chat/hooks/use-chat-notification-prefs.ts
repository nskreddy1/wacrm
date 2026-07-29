'use client';

import { useCallback, useMemo } from 'react';
import useSWR from 'swr';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/hooks/use-auth';

/**
 * Per-user chat notification preferences: a global popup switch, a
 * workspace-wide quiet period, and per-conversation mutes.
 *
 * These gate the POPUP ONLY. Unread badges are deliberately never
 * consulted here — a muted conversation must still visibly accumulate
 * messages, otherwise muting becomes silent data loss.
 *
 * Mutes are stored as `muted_until` timestamps, so expiry is a read-time
 * comparison and no sweeper job is needed. See migration
 * 20260729100000_chat_notification_prefs.sql.
 */

interface ChatPrefs {
  popupsEnabled: boolean;
  /** Workspace-wide quiet period, epoch ms. 0 when not muted. */
  mutedUntil: number;
  /** conversation_id -> mute expiry, epoch ms. */
  conversationMutes: Map<string, number>;
}

const EMPTY: ChatPrefs = {
  popupsEnabled: true,
  mutedUntil: 0,
  conversationMutes: new Map(),
};

/** Far-future sentinel for "mute indefinitely". */
const FOREVER = '9999-12-31T00:00:00.000Z';

function toMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

async function fetchPrefs(userId: string): Promise<ChatPrefs> {
  const supabase = createClient();

  const [globalRes, convRes] = await Promise.all([
    supabase
      .from('member_chat_prefs')
      .select('popups_enabled, muted_until')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('team_conversation_prefs')
      .select('conversation_id, muted_until')
      .eq('user_id', userId),
  ]);

  const conversationMutes = new Map<string, number>();
  for (const row of convRes.data ?? []) {
    const until = toMs(row.muted_until as string | null);
    if (until > 0) conversationMutes.set(row.conversation_id as string, until);
  }

  return {
    // No row yet is the default state, not an error: popups on, nothing muted.
    popupsEnabled: globalRes.data?.popups_enabled ?? true,
    mutedUntil: toMs(globalRes.data?.muted_until as string | null),
    conversationMutes,
  };
}

export function useChatNotificationPrefs(enabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data, mutate } = useSWR(
    enabled && userId ? (['chat-prefs', userId] as const) : null,
    ([, uid]) => fetchPrefs(uid),
    // Preferences change only by this user's own action, and the mutations
    // below revalidate. No polling.
    { revalidateOnFocus: false }
  );

  const prefs = data ?? EMPTY;

  /**
   * Whether a popup may be shown for this conversation right now.
   *
   * Evaluated at call time (not memoized against a clock) so a mute that
   * expires between renders stops suppressing immediately, without needing
   * a ticking timer to invalidate it.
   */
  const canPopup = useCallback(
    (conversationId: string): boolean => {
      if (!prefs.popupsEnabled) return false;
      const now = Date.now();
      if (prefs.mutedUntil > now) return false;
      const until = prefs.conversationMutes.get(conversationId);
      return !(until && until > now);
    },
    [prefs]
  );

  const isMuted = useCallback(
    (conversationId: string): boolean => {
      const until = prefs.conversationMutes.get(conversationId);
      return !!until && until > Date.now();
    },
    [prefs]
  );

  /** Mute a conversation. `durationMs` omitted means indefinitely. */
  const muteConversation = useCallback(
    async (conversationId: string, durationMs?: number) => {
      if (!userId) return;
      const until = durationMs
        ? new Date(Date.now() + durationMs).toISOString()
        : FOREVER;

      void mutate(
        (prev) => {
          const next = new Map(prev?.conversationMutes ?? []);
          next.set(conversationId, toMs(until));
          return { ...(prev ?? EMPTY), conversationMutes: next };
        },
        { revalidate: false }
      );

      const supabase = createClient();
      const { error } = await supabase.from('team_conversation_prefs').upsert(
        {
          user_id: userId,
          conversation_id: conversationId,
          muted_until: until,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,conversation_id' }
      );
      // Re-sync on failure so the UI can't claim a mute the DB rejected.
      if (error) void mutate();
    },
    [userId, mutate]
  );

  const unmuteConversation = useCallback(
    async (conversationId: string) => {
      if (!userId) return;

      void mutate(
        (prev) => {
          const next = new Map(prev?.conversationMutes ?? []);
          next.delete(conversationId);
          return { ...(prev ?? EMPTY), conversationMutes: next };
        },
        { revalidate: false }
      );

      const supabase = createClient();
      const { error } = await supabase.from('team_conversation_prefs').upsert(
        {
          user_id: userId,
          conversation_id: conversationId,
          muted_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,conversation_id' }
      );
      if (error) void mutate();
    },
    [userId, mutate]
  );

  const setPopupsEnabled = useCallback(
    async (popupsEnabled: boolean) => {
      if (!userId) return;

      void mutate((prev) => ({ ...(prev ?? EMPTY), popupsEnabled }), {
        revalidate: false,
      });

      const supabase = createClient();
      const { error } = await supabase.from('member_chat_prefs').upsert(
        {
          user_id: userId,
          popups_enabled: popupsEnabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (error) void mutate();
    },
    [userId, mutate]
  );

  return useMemo(
    () => ({
      popupsEnabled: prefs.popupsEnabled,
      canPopup,
      isMuted,
      muteConversation,
      unmuteConversation,
      setPopupsEnabled,
    }),
    [
      prefs.popupsEnabled,
      canPopup,
      isMuted,
      muteConversation,
      unmuteConversation,
      setPopupsEnabled,
    ]
  );
}
