import { decryptProviderCredentials } from '../credentials';
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
  OutboundChannelMessage,
} from '../contracts';
import type { ChannelConnection } from '@/types';

/**
 * Mailtrap Email Sending adapter (send.api.mailtrap.io). Works with
 * Email Sending API tokens. Health check hits the sandbox-safe
 * /api/accounts endpoint; a 401 means the token is invalid, while
 * 403 still proves the token authenticates (it's just scoped to
 * sending only), so it counts as healthy.
 */
export class MailtrapEmailAdapter implements ChannelAdapter {
  readonly provider = 'mailtrap' as const;
  readonly channel = 'email' as const;
  readonly capabilities = {
    send: true,
    receive: false,
    healthCheck: true,
    oauth: false,
    testMessage: true,
  } as const;

  async send(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    const credentials = decryptProviderCredentials(message.connection);
    if (credentials.provider !== 'mailtrap')
      throw new Error('Mailtrap credentials required');
    const from = message.connection.external_identity;
    if (!from) throw new Error('Mailtrap sender identity is not configured');

    const response = await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.value.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { email: from },
        to: [{ email: message.recipient.identity }],
        subject: message.subject ?? '(no subject)',
        ...(message.text ? { text: message.text } : {}),
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      message_ids?: string[];
      errors?: string[];
    };
    if (!response.ok || payload.success === false) {
      throw new Error(
        payload.errors?.[0] ?? `Mailtrap send failed (${response.status})`
      );
    }
    return {
      externalMessageId: payload.message_ids?.[0] ?? `mailtrap-${Date.now()}`,
      acceptedAt: new Date().toISOString(),
    };
  }

  async checkHealth(connection: ChannelConnection): Promise<ChannelHealth> {
    try {
      const credentials = decryptProviderCredentials(connection);
      if (credentials.provider !== 'mailtrap')
        throw new Error('Mailtrap credentials required');
      const response = await fetch('https://mailtrap.io/api/accounts', {
        headers: { 'Api-Token': credentials.value.token },
      });
      // 200 = full-access token; 403 = valid but sending-scoped token.
      // Only 401 means the token itself is bad.
      const ok = response.ok || response.status === 403;
      return {
        ok,
        checkedAt: new Date().toISOString(),
        error: ok ? undefined : `Mailtrap returned ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : 'Mailtrap health check failed',
      };
    }
  }
}
