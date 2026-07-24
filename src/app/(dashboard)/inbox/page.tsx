'use client';

import { InboxWorkspace } from '@/features/inbox/components/inbox-workspace';

/**
 * WhatsApp Inbox — the primary conversation workspace. The full
 * three-pane UI lives in InboxWorkspace; this route pins it to the
 * WhatsApp channel. The SMS counterpart is at /inbox/sms.
 */
export default function WhatsAppInboxPage() {
  return <InboxWorkspace channel="whatsapp" />;
}
