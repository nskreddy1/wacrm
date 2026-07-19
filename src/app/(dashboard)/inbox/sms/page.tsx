"use client";

import { InboxWorkspace } from "@/components/inbox/inbox-workspace";

/**
 * SMS Inbox — a fully separate conversation workspace scoped to the
 * SMS channel (Twilio Programmable Messaging). Threads here never mix
 * with the WhatsApp inbox at /inbox: conversation fetches, realtime
 * patches, and connection banners are all channel-filtered.
 */
export default function SmsInboxPage() {
  return <InboxWorkspace channel="sms" />;
}
