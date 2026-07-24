import { channelAdmin } from '@/features/channels/lib/admin-client';
import { dispatchWebhookEvent } from '@/features/webhooks/lib/deliver';

// ============================================================
// Unified delivery-status tracking (Phase 2c).
//
// One channel-agnostic entry point for provider delivery receipts
// (Meta statuses, Twilio StatusCallback, Resend events later).
// Mirrors onto `messages`, `broadcast_recipients`, and fans out
// the `message.status_updated` webhook event — the same three
// steps the legacy Meta webhook performs, extracted so every
// provider webhook shares them.
// ============================================================

/** Statuses accepted by the messages.status CHECK constraint (schema 001). */
export type UnifiedDeliveryStatus =
  'sending' | 'sent' | 'delivered' | 'read' | 'failed';

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Provider webhook replays must never regress a recipient
// back down this ladder. `failed` is a terminal side branch only
// valid from the early states.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const;

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
  return idx < 0 ? -1 : idx;
}

export function isValidStatusTransition(
  current: string,
  incoming: string
): boolean {
  if (incoming === 'failed') return current === 'pending' || current === 'sent';
  if (current === 'failed') return false; // failed is terminal
  const ci = ladderLevel(current);
  const ii = ladderLevel(incoming);
  if (ii < 0) return false;
  if (ci < 0) return true;
  return ii > ci;
}

/**
 * Map Twilio Message statuses onto the unified ladder.
 * Returns null for statuses we deliberately ignore (pre-send churn).
 */
export function mapTwilioStatus(status: string): UnifiedDeliveryStatus | null {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'undelivered':
      return 'failed';
    default:
      // queued | accepted | sending | scheduled | canceled — no row churn.
      return null;
  }
}

export interface DeliveryStatusEvent {
  /** Provider message id — Meta wamid or Twilio SM/MM sid. */
  externalMessageId: string;
  status: UnifiedDeliveryStatus;
  /** ISO timestamp of when the provider says the event occurred. */
  occurredAt: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Apply one provider delivery-status event. Idempotent and
 * replay-safe: forward-only transitions, best-effort mirrors.
 */
export async function applyMessageDeliveryStatus(
  event: DeliveryStatusEvent
): Promise<void> {
  const db = channelAdmin();

  // 1) Mirror onto messages. No `.select()`: message_id is NOT unique
  //    (provider ids can repeat across numbers), so this updates 0..N
  //    rows and must not assume a single row.
  const { error: msgErr } = await db
    .from('messages')
    .update({ status: event.status })
    .eq('message_id', event.externalMessageId);
  if (msgErr) console.error('[status] messages update failed:', msgErr.message);

  // 2) Mirror onto broadcast_recipients (aggregate trigger re-derives
  //    the parent broadcast's counts automatically).
  const { data: recipient, error: recErr } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', event.externalMessageId)
    .maybeSingle();
  if (recErr) {
    console.error('[status] broadcast recipient fetch failed:', recErr.message);
  } else if (
    recipient &&
    isValidStatusTransition(recipient.status, event.status)
  ) {
    const update: Record<string, unknown> = { status: event.status };
    if (event.status === 'sent') update.sent_at = event.occurredAt;
    if (event.status === 'delivered') update.delivered_at = event.occurredAt;
    if (event.status === 'read') update.read_at = event.occurredAt;
    if (event.status === 'failed' && event.errorMessage) {
      update.error_message = event.errorCode
        ? `${event.errorMessage} (${event.errorCode})`
        : event.errorMessage;
    }
    const { error: updErr } = await db
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id);
    if (updErr)
      console.error(
        '[status] broadcast recipient update failed:',
        updErr.message
      );
  }

  // 3) Webhook fan-out — runs last so a slow subscriber can't delay
  //    the mirrors above. Bounded to one row purely to resolve the
  //    owning account.
  const { data: msgRow } = await db
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', event.externalMessageId)
    .limit(1)
    .maybeSingle();
  if (msgRow) {
    const conv = msgRow.conversations as unknown as {
      account_id: string;
    } | null;
    if (conv?.account_id) {
      await dispatchWebhookEvent(
        db,
        conv.account_id,
        'message.status_updated',
        {
          whatsapp_message_id: event.externalMessageId,
          conversation_id: msgRow.conversation_id,
          status: event.status,
          ...(event.errorCode ? { error_code: event.errorCode } : {}),
        }
      );
    }
  }
}
