/**
 * External alert delivery — shared contracts.
 *
 * One separate connector per provider (deliberately NOT a generic OAuth
 * abstraction — see plan). Adapters share only this thin send-interface;
 * everything else (connection flow, credential shape, settings card) is
 * provider-specific.
 */

/**
 * Providers this build can deliver to.
 *
 * Narrower than the `alert_destinations.provider` CHECK constraint, which
 * still permits 'whatsapp' | 'telegram' | 'email'. That is intentional: the
 * constraint is already applied in production and widening a CHECK later is
 * additive, whereas tightening it now would be a destructive migration for
 * no gain. The dispatcher parks (never dead-letters) rows for providers it
 * has no adapter for, so an unknown value in the column is safe.
 */
export type AlertProvider = 'team_chat' | 'slack';

export type AlertDeliveryStatus = 'pending' | 'sent' | 'failed' | 'dead';

/** Non-secret routing config stored in alert_destinations.config. */
export interface SlackDestinationConfig {
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
}

export interface AlertDestination {
  id: string;
  account_id: string;
  provider: AlertProvider;
  display_name: string;
  config: Record<string, unknown>;
  /** Only present when loaded with the service-role client. */
  credentials_encrypted?: string | null;
  event_types: string[];
  enabled: boolean;
}

/**
 * Denormalized snapshot persisted in alert_deliveries.payload at enqueue
 * time, so dispatch never depends on the notification row still existing.
 */
export interface AlertPayload {
  title: string;
  body: string;
  /** Deep link back into the app (absolute URL). */
  url?: string;
  conversation_id?: string;
  notification_type: string;
}

export interface AlertDeliveryRow {
  id: string;
  account_id: string;
  notification_id: string;
  destination_id: string;
  status: AlertDeliveryStatus;
  payload: AlertPayload;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
}

export type AlertSendResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /**
       * false = permanent (bad token, channel deleted, invalid config):
       * dead-letter immediately instead of burning retries and quota.
       */
      retryable: boolean;
    };

export interface AlertAdapter {
  readonly provider: AlertProvider;
  send(
    destination: AlertDestination,
    payload: AlertPayload
  ): Promise<AlertSendResult>;
}

/** Retry schedule: 1m, 5m, 25m, then dead-letter. */
export const MAX_ATTEMPTS = 4;
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_FACTOR = 5;

export function nextBackoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, Math.max(0, attempts - 1));
}
