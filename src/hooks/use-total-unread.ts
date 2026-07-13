"use client";

import useSWR from "swr";

type InboxSummaryPayload = {
  data?: { unreadConversations?: number };
};

async function fetchInboxSummary(url: string): Promise<InboxSummaryPayload> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to load inbox summary");
  return response.json() as Promise<InboxSummaryPayload>;
}

/**
 * Count of conversations with unread inbound messages. The hook uses the
 * canonical workspace endpoint so navigation never needs database credentials
 * or a browser-side Supabase query. Revalidation keeps the badge current while
 * still allowing the mock and production adapters to share one contract.
 */
export function useTotalUnread(): number {
  const { data } = useSWR<InboxSummaryPayload>(
    "/api/v1/workspace/inbox/summary",
    fetchInboxSummary,
    { refreshInterval: 30_000, revalidateOnFocus: true },
  );

  return data?.data?.unreadConversations ?? 0;
}
