import type { supabaseAdmin } from '@/features/flows/lib/admin-client';
import type { AlertPayload } from './types';

/**
 * Fan a single alert event out to every enabled external destination of the
 * account — the "write" half of the transactional outbox.
 *
 * Anchor semantics: the watchdog inserts one `notifications` row PER
 * RECIPIENT, but an external channel (a Slack channel, an ops WhatsApp
 * group) must hear about the event exactly ONCE. Callers therefore pass a
 * single anchor notification id (the first inserted row). Combined with the
 * UNIQUE(notification_id, destination_id) constraint, re-runs and cron
 * overlap can never produce a duplicate send.
 *
 * Failure isolation: enqueue errors are logged, never thrown — a broken
 * alert pipe must not break the in-app notification path that already works.
 */
export async function enqueueAlertDeliveries(
  db: typeof supabaseAdmin,
  input: {
    accountId: string;
    notificationId: string;
    notificationType: string;
    payload: AlertPayload;
  }
): Promise<{ enqueued: number }> {
  const { data: destinations, error: destErr } = await db
    .from('alert_destinations')
    .select('id')
    .eq('account_id', input.accountId)
    .eq('enabled', true)
    .contains('event_types', [input.notificationType]);

  if (destErr) {
    console.error('[alerts] destination lookup failed:', destErr.message);
    return { enqueued: 0 };
  }
  if (!destinations || destinations.length === 0) return { enqueued: 0 };

  const rows = destinations.map((d: { id: string }) => ({
    account_id: input.accountId,
    notification_id: input.notificationId,
    destination_id: d.id,
    payload: input.payload,
  }));

  // ignoreDuplicates -> ON CONFLICT DO NOTHING on the unique pair: the
  // idempotency anchor, not an error to surface.
  const { error: insErr, count } = await db
    .from('alert_deliveries')
    .upsert(rows, {
      onConflict: 'notification_id,destination_id',
      ignoreDuplicates: true,
      count: 'exact',
    });

  if (insErr) {
    console.error('[alerts] delivery enqueue failed:', insErr.message);
    return { enqueued: 0 };
  }
  return { enqueued: count ?? rows.length };
}
