'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/hooks/use-auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamChatMember {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  role: string;
}

export interface TeamConversation {
  id: string;
  kind: 'dm' | 'channel';
  name: string | null;
  dm_key: string | null;
  created_by: string;
  last_message_at: string | null;
  last_message_text: string | null;
  /** All participant user ids (including self). */
  member_ids: string[];
}

export interface TeamMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

interface MembersResponse {
  members: TeamChatMember[];
}

// How far back we scan when computing initial unread counts. Anything
// older than this simply shows no badge, which is the industry norm
// (Slack does the same with its "while you were away" window).
const UNREAD_SCAN_DAYS = 14;

/** Combined SWR snapshot: the conversation list plus unread counts. */
interface ConversationsSnapshot {
  conversations: TeamConversation[];
  unread: Map<string, number>;
}

// Stable fallbacks so consumers get referentially-equal empties while
// the snapshot loads (avoids re-render churn in memoized children).
const EMPTY_CONVERSATIONS: TeamConversation[] = [];
const EMPTY_UNREAD: Map<string, number> = new Map();

/**
 * Pure fetcher: conversations + read cursors + unread counts in one
 * snapshot. Unread = recent messages newer than my cursor, sent by others.
 */
async function fetchConversationsSnapshot(
  myId: string
): Promise<ConversationsSnapshot> {
  const supabase = createClient();

  const [{ data: convs, error }, { data: cursors }] = await Promise.all([
    supabase
      .from('team_conversations')
      .select(
        'id, kind, name, dm_key, created_by, last_message_at, last_message_text, team_conversation_members(user_id)'
      )
      .order('last_message_at', { ascending: false, nullsFirst: false }),
    supabase.from('team_read_cursors').select('conversation_id, last_read_at'),
  ]);
  if (error)
    throw new Error(
      `[useTeamChat] conversations fetch error: ${error.message}`
    );

  const conversations: TeamConversation[] = (convs ?? []).map((c) => ({
    id: c.id as string,
    kind: c.kind as 'dm' | 'channel',
    name: (c.name as string | null) ?? null,
    dm_key: (c.dm_key as string | null) ?? null,
    created_by: c.created_by as string,
    last_message_at: (c.last_message_at as string | null) ?? null,
    last_message_text: (c.last_message_text as string | null) ?? null,
    member_ids: (
      (c.team_conversation_members as { user_id: string }[]) ?? []
    ).map((m) => m.user_id),
  }));

  const cursorMap = new Map<string, string>();
  for (const cur of cursors ?? []) {
    cursorMap.set(cur.conversation_id as string, cur.last_read_at as string);
  }
  const since = new Date(
    Date.now() - UNREAD_SCAN_DAYS * 86_400_000
  ).toISOString();
  const { data: recent } = await supabase
    .from('team_messages')
    .select('conversation_id, sender_id, created_at')
    .gte('created_at', since)
    .limit(1000);
  const unread = new Map<string, number>();
  for (const m of recent ?? []) {
    const convId = m.conversation_id as string;
    if (m.sender_id === myId) continue;
    const readAt = cursorMap.get(convId);
    if (readAt && (m.created_at as string) <= readAt) continue;
    unread.set(convId, (unread.get(convId) ?? 0) + 1);
  }
  return { conversations, unread };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * All state for the team chat widget: workspace members, the caller's
 * conversations (DMs + channels), unread counts, the active thread's
 * messages, and realtime delivery. Everything reads/writes Supabase
 * directly from the browser — RLS (migration team_chat) scopes every
 * row to conversation participants within the workspace.
 */
export function useTeamChat(enabled: boolean) {
  const { user, accountId } = useAuth();
  const myId = user?.id ?? null;

  // Workspace roster (existing endpoint, shared with Settings > Members).
  const { data: membersData } = useSWR<MembersResponse>(
    enabled ? '/api/account/members' : null
  );
  const members = useMemo(
    () => (membersData?.members ?? []).filter((m) => m.user_id !== myId),
    [membersData, myId]
  );
  const memberById = useMemo(() => {
    const map = new Map<string, TeamChatMember>();
    for (const m of membersData?.members ?? []) map.set(m.user_id, m);
    return map;
  }, [membersData]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Refs so realtime callbacks always see current values without
  // re-subscribing the channel.
  const activeIdRef = useRef(activeId);
  const myIdRef = useRef(myId);
  useEffect(() => {
    activeIdRef.current = activeId;
    myIdRef.current = myId;
  });

  // ----- conversations + read cursors + unread counts -----
  // SWR owns the fetch (key is null until enabled and signed in);
  // realtime events overlay the cached snapshot via optimistic mutate.
  const { data: convData, mutate: mutateConvs } = useSWR(
    enabled && myId ? (['team-chat-conversations', myId] as const) : null,
    ([, uid]) => fetchConversationsSnapshot(uid)
  );
  const conversations = convData?.conversations ?? EMPTY_CONVERSATIONS;
  const unread = convData?.unread ?? EMPTY_UNREAD;
  const loadConversations = useCallback(() => mutateConvs(), [mutateConvs]);

  // ----- read cursor -----
  const markReadInternal = useCallback(async (conversationId: string) => {
    const uid = myIdRef.current;
    if (!uid) return;
    const supabase = createClient();
    await supabase.from('team_read_cursors').upsert(
      {
        conversation_id: conversationId,
        user_id: uid,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id,user_id' }
    );
  }, []);

  // ----- realtime: new messages + conversation upserts -----
  useEffect(() => {
    if (!enabled || !accountId || !myId) return;
    const supabase = createClient();

    const channel: RealtimeChannel = supabase
      .channel(`team-chat:${accountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'team_messages' },
        (payload) => {
          const msg = payload.new as TeamMessage;
          const mine = msg.sender_id === myIdRef.current;
          const isActive = msg.conversation_id === activeIdRef.current;

          // Overlay the cached snapshot: bump the conversation preview +
          // ordering, and bump unread for inactive threads. If the
          // conversation isn't loaded yet (e.g. someone just DM'd me for
          // the first time), fall through to a full revalidate.
          let needsRefetch = false;
          void mutateConvs(
            (prev) => {
              if (!prev) return prev;
              const idx = prev.conversations.findIndex(
                (c) => c.id === msg.conversation_id
              );
              if (idx === -1) {
                needsRefetch = true;
                return prev;
              }
              const nextConvs = [...prev.conversations];
              nextConvs[idx] = {
                ...nextConvs[idx],
                last_message_at: msg.created_at,
                last_message_text: msg.body.slice(0, 140),
              };
              nextConvs.sort((a, b) =>
                (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')
              );
              let nextUnread = prev.unread;
              if (!mine && !isActive) {
                nextUnread = new Map(prev.unread);
                nextUnread.set(
                  msg.conversation_id,
                  (nextUnread.get(msg.conversation_id) ?? 0) + 1
                );
              }
              return { conversations: nextConvs, unread: nextUnread };
            },
            { revalidate: false }
          ).then(() => {
            if (needsRefetch) void mutateConvs();
          });

          if (isActive) {
            // Viewing this thread: append & immediately mark read.
            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
            );
            if (!mine) void markReadInternal(msg.conversation_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, accountId, myId, mutateConvs, markReadInternal]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      setActiveId(conversationId);
      setLoading(true);
      setMessages([]);
      // Clear the unread badge for this thread in the cached snapshot.
      void mutateConvs(
        (prev) => {
          if (!prev || !prev.unread.has(conversationId)) return prev;
          const nextUnread = new Map(prev.unread);
          nextUnread.delete(conversationId);
          return { conversations: prev.conversations, unread: nextUnread };
        },
        { revalidate: false }
      );
      const supabase = createClient();
      const { data, error } = await supabase
        .from('team_messages')
        .select('id, conversation_id, sender_id, body, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) {
        console.error('[useTeamChat] messages fetch error:', error.message);
      }
      setMessages((data as TeamMessage[]) ?? []);
      setLoading(false);
      void markReadInternal(conversationId);
    },
    [markReadInternal, mutateConvs]
  );

  const closeConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
  }, []);

  // ----- start (or resume) a DM -----
  const openDm = useCallback(
    async (otherUserId: string): Promise<string | null> => {
      if (!myId || !accountId) return null;
      const dmKey = [myId, otherUserId].sort().join(':');
      const existing = conversations.find((c) => c.dm_key === dmKey);
      if (existing) {
        await openConversation(existing.id);
        return existing.id;
      }
      const supabase = createClient();
      // Someone else may have created it (RLS hides DMs we're not in
      // until membership rows exist, so check by key via insert race).
      const { data: created, error } = await supabase
        .from('team_conversations')
        .insert({
          account_id: accountId,
          kind: 'dm',
          dm_key: dmKey,
          created_by: myId,
        })
        .select('id')
        .single();
      if (error) {
        // Unique violation -> the pair already has a DM; reload to pick it up.
        if (error.code === '23505') {
          await loadConversations();
          return null;
        }
        console.error('[useTeamChat] openDm error:', error.message);
        return null;
      }
      const convId = created.id as string;
      const { error: memberError } = await supabase
        .from('team_conversation_members')
        .insert([
          { conversation_id: convId, user_id: myId },
          { conversation_id: convId, user_id: otherUserId },
        ]);
      if (memberError) {
        console.error(
          '[useTeamChat] openDm members error:',
          memberError.message
        );
        return null;
      }
      await loadConversations();
      await openConversation(convId);
      return convId;
    },
    [myId, accountId, conversations, openConversation, loadConversations]
  );

  // ----- create a channel (admin+ per RLS) -----
  const createChannel = useCallback(
    async (
      name: string,
      memberIds: string[]
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!myId || !accountId) return { ok: false, error: 'Not signed in' };
      const supabase = createClient();
      const { data: created, error } = await supabase
        .from('team_conversations')
        .insert({
          account_id: accountId,
          kind: 'channel',
          name: name.trim(),
          created_by: myId,
        })
        .select('id')
        .single();
      if (error) {
        const friendly =
          error.code === '42501'
            ? 'Only workspace admins can create channels.'
            : error.message;
        return { ok: false, error: friendly };
      }
      const convId = created.id as string;
      const rows = [myId, ...memberIds.filter((id) => id !== myId)].map(
        (uid) => ({
          conversation_id: convId,
          user_id: uid,
        })
      );
      const { error: memberError } = await supabase
        .from('team_conversation_members')
        .insert(rows);
      if (memberError) return { ok: false, error: memberError.message };
      await loadConversations();
      await openConversation(convId);
      return { ok: true };
    },
    [myId, accountId, loadConversations, openConversation]
  );

  // ----- send -----
  const sendMessage = useCallback(
    async (body: string) => {
      const convId = activeIdRef.current;
      const uid = myIdRef.current;
      if (!convId || !uid || !accountId || !body.trim()) return;
      setSending(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('team_messages')
        .insert({
          conversation_id: convId,
          account_id: accountId,
          sender_id: uid,
          body: body.trim(),
        })
        .select('id, conversation_id, sender_id, body, created_at')
        .single();
      setSending(false);
      if (error) {
        console.error('[useTeamChat] send error:', error.message);
        return;
      }
      // Optimistically append (realtime will de-dupe by id).
      const msg = data as TeamMessage;
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
      );
      void markReadInternal(convId);
    },
    [accountId, markReadInternal]
  );

  // ----- derived -----
  const totalUnread = useMemo(() => {
    let sum = 0;
    for (const n of unread.values()) sum += n;
    return sum;
  }, [unread]);

  /** Display title + the "other" user for DMs (for presence dots). */
  const describeConversation = useCallback(
    (conv: TeamConversation): { title: string; dmUserId: string | null } => {
      if (conv.kind === 'channel')
        return { title: conv.name ?? 'Channel', dmUserId: null };
      const otherId = conv.member_ids.find((id) => id !== myId) ?? null;
      const other = otherId ? memberById.get(otherId) : null;
      return {
        title: other?.full_name || other?.email || 'Direct message',
        dmUserId: otherId,
      };
    },
    [myId, memberById]
  );

  return {
    myId,
    members,
    memberById,
    conversations,
    unread,
    totalUnread,
    activeId,
    messages,
    loading,
    sending,
    openConversation,
    closeConversation,
    openDm,
    createChannel,
    sendMessage,
    describeConversation,
  };
}
