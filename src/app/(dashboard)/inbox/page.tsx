'use client';

import { InboxWorkspace } from '@/features/inbox/components/inbox-workspace';

/**
 * Inbox — the single conversation workspace. The full three-pane UI
 * lives in InboxWorkspace; this route pins it to WhatsApp, the only
 * customer channel in use today.
 */
export default function WhatsAppInboxPage() {
  return <InboxWorkspace channel="whatsapp" />;
}
