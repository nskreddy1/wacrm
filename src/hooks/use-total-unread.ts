"use client";

import useSWR from "swr";

import { useRealtime } from "@/hooks/use-realtime";

type InboxSummaryPayload = {
  data?: { unreadConversations?: number };
};

async function fetchInboxSummary(url: string): Promise<InboxSummaryPayload> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to load inbox summary");
  return response.json() as Promise<InboxSummaryPayload>;
}

/**
 * Count of conversations with unread inbound messages. Push-based: a
 * Supabase Realtime subscription on messages/conversations triggers a
 * revalidation of the canonical workspace endpoint the moment data
 * changes, so the badge updates instantly without tight polling. A slow
 * 5-minute poll remains as a fallback for missed events (e.g. dropped
 * socket), and reconnects self-heal via `revalidateOnReconnect`.
 */
export function useTotalUnread(): number {
  const { data, mutate } = useSWR<InboxSummaryPayload>(
    "/api/v1/workspace/inbox/summary",
    fetchInboxSummary,
    { refreshInterval: 300_000, revalidateOnFocus: true },
  );

  useRealtime({
    channelName: "unread-badge",
    onMessageEvent: () => void mutate(),
    onConversationEvent: () => void mutate(),
  });

  return data?.data?.unreadConversations ?? 0;
}
