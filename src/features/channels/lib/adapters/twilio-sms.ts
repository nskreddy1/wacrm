import { decryptProviderCredentials } from '../credentials';
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
  OutboundChannelMessage,
} from '../contracts';
import type { ChannelConnection } from '@/types';
import { TwilioSendError } from './twilio';

/**
 * Public https base URL for Twilio delivery-status callbacks.
 * Skipped for local/preview hosts Twilio cannot reach — sends still
 * work, they just do not get delivered/failed receipts.
 */
function statusCallbackUrl(): string | null {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);
  if (!base || !base.startsWith('https://') || base.includes('localhost'))
    return null;
  return `${base.replace(/\/$/, '')}/api/channels/webhooks/twilio`;
}

/**
 * Twilio Programmable Messaging (SMS) adapter.
 *
 * Same Messages API as the WhatsApp adapter but with bare E.164
 * addresses (no `whatsapp:` prefix) and text-first payloads. SMS has
 * no carrier-reviewed template concept — approved SMS templates are
 * rendered to plain text upstream and arrive here as `text` payloads.
 * MMS media is passed through via MediaUrl where the sender number
 * supports it.
 */
export class TwilioSmsAdapter implements ChannelAdapter {
  readonly provider = 'twilio' as const;
  readonly channel = 'sms' as const;
  readonly capabilities = {
    send: true,
    receive: true,
    healthCheck: true,
    oauth: false,
    testMessage: false,
  } as const;

  async send(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    const credentials = decryptProviderCredentials(message.connection);
    if (credentials.provider !== 'twilio')
      throw new Error('Twilio credentials required');

    // Prefer a Messaging Service (MG…) when configured: Twilio then
    // handles sender selection, Sticky Sender, Advanced Opt-Out, and
    // queue pacing (docs: /docs/messaging/services). Otherwise fall
    // back to the connection's dedicated From number.
    // Precedence: plain configuration (editable in the connection
    // sheet without retyping secrets) > encrypted credentials blob.
    const configSid = (
      message.connection.configuration as { messaging_service_sid?: string }
    )?.messaging_service_sid?.trim();
    const messagingServiceSid =
      configSid || credentials.value.messagingServiceSid?.trim();
    const from = message.connection.external_identity;
    if (!messagingServiceSid && !from) {
      throw new Error(
        'Twilio SMS sender number or Messaging Service SID is not configured'
      );
    }

    const body = new URLSearchParams({ To: message.recipient.identity });
    if (messagingServiceSid) {
      body.set('MessagingServiceSid', messagingServiceSid);
    } else if (from) {
      // Users often save display-formatted numbers like "(858) 330-6215";
      // Twilio requires E.164, so normalize before sending (error 21212).
      body.set('From', `+${from.replace(/\D/g, '')}`);
    }

    const payload = message.payload;
    switch (payload?.kind) {
      case 'text':
        body.set('Body', payload.text);
        break;
      case 'media':
        // MMS — supported on US/CA long codes and toll-free numbers.
        body.set('MediaUrl', payload.url);
        if (payload.caption?.trim()) body.set('Body', payload.caption);
        break;
      default:
        // Legacy flat fields; rich kinds (template/interactive) are
        // rejected upstream by the orchestrator's strict-support gate.
        body.set('Body', message.text ?? '');
        if (message.mediaUrl) body.set('MediaUrl', message.mediaUrl);
        break;
    }

    const callback = statusCallbackUrl();
    if (callback) body.set('StatusCallback', callback);

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.value.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.value.accountSid}:${credentials.value.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': message.idempotencyKey,
        },
        body,
      }
    );
    const result = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      code?: number;
    };
    if (!response.ok || !result.sid) {
      throw new TwilioSendError(
        result.message ?? `Twilio SMS send failed (${response.status})`,
        result.code,
        response.status
      );
    }
    return {
      externalMessageId: result.sid,
      acceptedAt: new Date().toISOString(),
      providerPayload: { sid: result.sid },
    };
  }

  async checkHealth(connection: ChannelConnection): Promise<ChannelHealth> {
    try {
      const credentials = decryptProviderCredentials(connection);
      if (credentials.provider !== 'twilio')
        throw new Error('Twilio credentials required');
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.value.accountSid)}.json`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.value.accountSid}:${credentials.value.authToken}`).toString('base64')}`,
          },
        }
      );
      return {
        ok: response.ok,
        checkedAt: new Date().toISOString(),
        error: response.ok ? undefined : `Twilio returned ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        error:
          error instanceof Error ? error.message : 'Twilio health check failed',
      };
    }
  }
}
