import { decrypt } from '@/features/whatsapp/lib/encryption';
import type {
  AlertAdapter,
  AlertDestination,
  AlertPayload,
  AlertSendResult,
  SlackDestinationConfig,
} from '../types';

/**
 * Slack alert adapter.
 *
 * Uses the per-workspace bot token obtained through the OAuth v2 install
 * flow (the client logs into THEIR workspace in a popup — we never see
 * their password, Slack hands us a scoped xoxb- token which is stored
 * AES-256-GCM encrypted in alert_destinations.credentials_encrypted).
 *
 * Deliberately calls the Web API directly instead of the Chat SDK: the SDK's
 * Slack adapter reads one static SLACK_BOT_TOKEN env var (single-workspace),
 * while this app needs a different token per connected account.
 */

/**
 * Slack error codes that will never succeed on retry. Everything else
 * (rate_limited, service outages, fetch failures) is worth retrying.
 * Reference: Slack Web API chat.postMessage error table.
 */
const PERMANENT_SLACK_ERRORS = new Set([
  'invalid_auth',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'no_permission',
  'missing_scope',
  'channel_not_found',
  'is_archived',
  'not_in_channel',
  'restricted_action',
  'msg_too_long',
  'invalid_blocks',
]);

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
}

function isSlackConfig(
  config: Record<string, unknown>
): config is SlackDestinationConfig & Record<string, unknown> {
  return (
    typeof config.channel_id === 'string' && config.channel_id.length > 0
  );
}

export const slackAlertAdapter: AlertAdapter = {
  provider: 'slack',

  async send(
    destination: AlertDestination,
    payload: AlertPayload
  ): Promise<AlertSendResult> {
    if (!destination.credentials_encrypted) {
      return {
        ok: false,
        error: 'Slack destination has no stored credentials',
        retryable: false,
      };
    }
    if (!isSlackConfig(destination.config)) {
      return {
        ok: false,
        error: 'Slack destination config is missing channel_id',
        retryable: false,
      };
    }

    let botToken: string;
    try {
      botToken = decrypt(destination.credentials_encrypted);
    } catch {
      return {
        ok: false,
        error: 'Failed to decrypt Slack credentials',
        retryable: false,
      };
    }

    const lines = [`*${payload.title}*`, payload.body];
    if (payload.url) lines.push(`<${payload.url}|Open conversation>`);

    let response: Response;
    try {
      response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          channel: destination.config.channel_id,
          text: `${payload.title} — ${payload.body}`,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: lines.join('\n') },
            },
          ],
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
    } catch (error) {
      return {
        ok: false,
        error: `Slack request failed: ${error instanceof Error ? error.message : 'network error'}`,
        retryable: true,
      };
    }

    // HTTP-level failures (429, 5xx) are transient.
    if (!response.ok) {
      return {
        ok: false,
        error: `Slack HTTP ${response.status}`,
        retryable: true,
      };
    }

    const data = (await response.json()) as SlackPostMessageResponse;
    if (!data.ok) {
      const code = data.error ?? 'unknown_error';
      return {
        ok: false,
        error: `Slack API error: ${code}`,
        retryable: !PERMANENT_SLACK_ERRORS.has(code),
      };
    }

    return { ok: true };
  },
};
