import type { SupabaseClient } from '@supabase/supabase-js';
import { emailAlertAdapter } from './adapters/email';
import { slackAlertAdapter } from './adapters/slack';
import { teamChatAlertAdapter } from './adapters/team-chat';
import { telegramAlertAdapter } from './adapters/telegram';
import { whatsappAlertAdapter } from './adapters/whatsapp';
import {
  MAX_ATTEMPTS,
  nextBackoffMs,
  type AlertAdapter,
  type AlertDeliveryRow,
  type AlertDestination,
} from './types';

/**
 * Outbox dispatcher — the "read" half of the transactional outbox.
 *
 * Runs on a per-minute cron (same pg_cron pattern as the handoff watchdog).
 * Claims due deliveries, routes each to its provider adapter, and records
 * the outcome:
 *
 *   sent            → terminal, never touched again
 *   failed          → retried with exponential backoff (1m, 5m, 25m)
 *   dead            → terminal; permanent provider errors (revoked token,
 *                     deleted channel) or MAX_ATTEMPTS exhausted. Dead rows
 *                     stop burning provider quota and stay visible in
 *                     settings so an admin can see WHY delivery stopped.
 *
 * Overlap safety: cron ticks can overlap a slow run. Each row is claimed
 * with an optimistic compare-and-swap on `attempts` — if another tick
 * already bumped it, the update matches 0 rows and this tick skips the
 * delivery. No row can be sent twice.
 */

const adapters: Record<string, AlertAdapter> = {
  [teamChatAlertAdapter.provider]: teamChatAlertAdapter,
  [slackAlertAdapter.provider]: slackAlertAdapter,
  [whatsappAlertAdapter.provider]: whatsappAlertAdapter,
  [telegramAlertAdapter.provider]: telegramAlertAdapter,
  [emailAlertAdapter.provider]: emailAlertAdapter,
};

/** Max deliveries per tick, so one backlog cannot melt a run. */
const BATCH_LIMIT = 50;

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
}

export async function dispatchPendingAlerts(
  db: SupabaseClient
): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, sent: 0, failed: 0, dead: 0 };

  const { data: due, error: dueErr } = await db
    .from('alert_deliveries')
    .select(
      'id, account_id, notification_id, destination_id, status, payload, attempts, next_attempt_at, last_error'
    )
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (dueErr) {
    console.error('[alerts dispatch] queue read failed:', dueErr.message);
    return result;
  }
  if (!due || due.length === 0) return result;

  // Batch-load all destinations for this tick in ONE query (avoids an N+1:
  // 50 rows would otherwise mean 50 extra round-trips per tick).
  const destinationIds = [
    ...new Set((due as AlertDeliveryRow[]).map((r) => r.destination_id)),
  ];
  const { data: destRows, error: destBatchErr } = await db
    .from('alert_destinations')
    .select(
      'id, account_id, provider, display_name, config, credentials_encrypted, event_types, enabled'
    )
    .in('id', destinationIds);

  if (destBatchErr) {
    console.error(
      '[alerts dispatch] destination batch read failed:',
      destBatchErr.message
    );
    return result;
  }
  const destinationById = new Map<string, AlertDestination>(
    ((destRows ?? []) as AlertDestination[]).map((d) => [d.id, d])
  );

  for (const row of due as AlertDeliveryRow[]) {
    try {
      // --- Optimistic claim (CAS on attempts) --------------------------
      const attempt = row.attempts + 1;
      const { data: claimedRows, error: claimErr } = await db
        .from('alert_deliveries')
        .update({ attempts: attempt })
        .eq('id', row.id)
        .eq('attempts', row.attempts)
        .in('status', ['pending', 'failed'])
        .select('id');

      if (claimErr || !claimedRows || claimedRows.length === 0) {
        // Another tick claimed it first — that tick owns the outcome.
        continue;
      }
      result.claimed += 1;

      // --- Destination from the batch map (credentials: service role only)
      const destination = destinationById.get(row.destination_id);

      if (!destination) {
        await markDead(db, row.id, 'Destination no longer exists');
        result.dead += 1;
        continue;
      }
      if (!destination.enabled) {
        await markDead(db, row.id, 'Destination is disabled');
        result.dead += 1;
        continue;
      }

      const adapter = adapters[destination.provider];
      if (!adapter) {
        // Provider adapter not shipped yet (whatsapp/telegram/email are
        // Phase 3). Leave the row pending WITHOUT consuming an attempt
        // beyond this claim — it will send once the adapter exists.
        await db
          .from('alert_deliveries')
          .update({
            attempts: row.attempts,
            last_error: `No adapter for provider ${destination.provider}`,
            next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          })
          .eq('id', row.id);
        continue;
      }

      // --- Send ---------------------------------------------------------
      const outcome = await adapter.send(destination, row.payload);

      if (outcome.ok) {
        await db
          .from('alert_deliveries')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', row.id);
        result.sent += 1;
        console.log(
          `[alerts dispatch] sent delivery=${row.id} provider=${destination.provider} account=${row.account_id}`
        );
        continue;
      }

      const exhausted = attempt >= MAX_ATTEMPTS;
      if (!outcome.retryable || exhausted) {
        await markDead(
          db,
          row.id,
          exhausted ? `${outcome.error} (max attempts reached)` : outcome.error
        );
        result.dead += 1;
        console.error(
          `[alerts dispatch] DEAD delivery=${row.id} provider=${destination.provider}: ${outcome.error}`
        );
        continue;
      }

      await db
        .from('alert_deliveries')
        .update({
          status: 'failed',
          last_error: outcome.error,
          next_attempt_at: new Date(
            Date.now() + nextBackoffMs(attempt)
          ).toISOString(),
        })
        .eq('id', row.id);
      result.failed += 1;
      console.error(
        `[alerts dispatch] retry delivery=${row.id} attempt=${attempt}: ${outcome.error}`
      );
    } catch (err) {
      // One poisoned row must not sink the batch.
      console.error(
        `[alerts dispatch] unexpected error on delivery=${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return result;
}

async function markDead(
  db: SupabaseClient,
  deliveryId: string,
  reason: string
): Promise<void> {
  await db
    .from('alert_deliveries')
    .update({ status: 'dead', last_error: reason })
    .eq('id', deliveryId);
}
