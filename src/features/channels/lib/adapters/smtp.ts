import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { ChannelConnection } from '@/types';
import { decryptProviderCredentials } from '../credentials';
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
  OutboundChannelMessage,
} from '../contracts';

const smtpConfigurationSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  requireTls: z.boolean().default(false),
  fromName: z.string().trim().max(120).optional(),
});

function safeSmtpError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'SMTP connection failed';
  const code = 'code' in error ? String(error.code) : '';
  if (code === 'EAUTH')
    return 'SMTP authentication failed. Check the username and password.';
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return 'Could not reach the SMTP server. Check the host, port, and TLS settings.';
  }
  return 'SMTP verification failed. Check the provider configuration.';
}

function transportFor(connection: ChannelConnection) {
  const configuration = smtpConfigurationSchema.parse(connection.configuration);
  if (configuration.secure && configuration.port === 587) {
    throw new Error(
      'Port 587 uses STARTTLS; turn off implicit TLS and enable Require TLS.'
    );
  }
  const credentials = decryptProviderCredentials(connection);
  if (credentials.provider !== 'smtp')
    throw new Error('SMTP credentials required');
  return nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: configuration.requireTls,
    auth: {
      user: credentials.value.username,
      pass: credentials.value.password,
    },
    tls: { minVersion: 'TLSv1.2' },
  });
}

export class SmtpEmailAdapter implements ChannelAdapter {
  readonly provider = 'smtp' as const;
  readonly channel = 'email' as const;
  readonly capabilities = {
    send: true,
    receive: false,
    healthCheck: true,
    oauth: false,
    testMessage: true,
  } as const;

  async send(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    const sender = message.connection.external_identity;
    if (!sender) throw new Error('SMTP sender identity is not configured');
    const configuration = smtpConfigurationSchema.parse(
      message.connection.configuration
    );
    const info = await transportFor(message.connection).sendMail({
      from: configuration.fromName
        ? { name: configuration.fromName, address: sender }
        : sender,
      to: message.recipient.identity,
      subject: message.subject ?? '(no subject)',
      text: message.text,
      html: message.html,
      inReplyTo: message.replyToExternalMessageId,
      headers: { 'X-WACRM-Idempotency-Key': message.idempotencyKey },
    });
    return {
      externalMessageId: info.messageId,
      acceptedAt: new Date().toISOString(),
    };
  }

  async checkHealth(connection: ChannelConnection): Promise<ChannelHealth> {
    try {
      await transportFor(connection).verify();
      return { ok: true, checkedAt: new Date().toISOString() };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        error: safeSmtpError(error),
      };
    }
  }

  async sendTest(
    connection: ChannelConnection,
    recipient: string
  ): Promise<ChannelSendResult> {
    return this.send({
      accountId: connection.account_id,
      connection,
      recipient: { contactId: 'connection-test', identity: recipient },
      contentType: 'text',
      subject: 'WACRM SMTP connection test',
      text: 'Your SMTP provider is connected to WACRM successfully.',
      idempotencyKey: `smtp-test-${crypto.randomUUID()}`,
    });
  }
}
