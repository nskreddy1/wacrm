import type {
  ChannelConnection,
  ChannelKind,
  ChannelProvider,
  ContentType,
} from '@/types';

export interface ChannelRecipient {
  contactId: string;
  identity: string;
  displayName?: string;
}

/**
 * Typed payload union for outbound messages.
 *
 * Adapters pick the branch(es) they support and throw for unsupported kinds.
 * The flat legacy fields on OutboundChannelMessage (text/html/subject/mediaUrl)
 * remain for backward compatibility with existing adapters; new callers should
 * prefer `payload`.
 */
export type OutboundMessagePayload =
  | { kind: 'text'; text: string }
  | {
      kind: 'media';
      mediaKind: 'image' | 'video' | 'document' | 'audio';
      url: string;
      caption?: string;
      filename?: string;
    }
  | {
      kind: 'template';
      templateName: string;
      language: string;
      /** Pre-built Meta template components (header/body/buttons parameters). */
      components?: unknown[];
      /**
       * Twilio Content API template SID (`HX…`). Required for template sends
       * on the Twilio provider; ignored by the Meta adapter.
       */
      contentSid?: string;
      /**
       * Twilio Content variables, positional or named,
       * e.g. `{ "1": "12/1", "2": "3pm" }`.
       */
      contentVariables?: Record<string, string>;
    }
  | {
      kind: 'interactive';
      /** Raw provider interactive payload (e.g. Meta `interactive` object). */
      interactive: Record<string, unknown>;
    }
  | { kind: 'email'; subject: string; text?: string; html?: string };

export interface OutboundChannelMessage {
  accountId: string;
  connection: ChannelConnection;
  recipient: ChannelRecipient;
  contentType: ContentType;
  /** Preferred typed payload. Takes precedence over the flat fields below. */
  payload?: OutboundMessagePayload;
  text?: string;
  html?: string;
  subject?: string;
  mediaUrl?: string;
  replyToExternalMessageId?: string;
  idempotencyKey: string;
}

export interface ChannelSendResult {
  externalMessageId: string;
  externalThreadId?: string;
  acceptedAt: string;
  providerPayload?: Record<string, unknown>;
}

export interface NormalizedInboundMessage {
  provider: ChannelProvider;
  channel: ChannelKind;
  connectionExternalIdentity: string;
  externalEventId: string;
  externalMessageId: string;
  externalThreadId?: string;
  senderIdentity: string;
  senderName?: string;
  recipientIdentity: string;
  subject?: string;
  text?: string;
  html?: string;
  contentType: ContentType;
  mediaUrl?: string;
  receivedAt: string;
  providerPayload: Record<string, unknown>;
}

export interface ChannelHealth {
  ok: boolean;
  checkedAt: string;
  error?: string;
}

export interface ChannelCapabilities {
  send: boolean;
  receive: boolean;
  healthCheck: boolean;
  oauth: boolean;
  testMessage: boolean;
}

export interface ChannelAdapter {
  readonly provider: ChannelProvider;
  readonly channel: ChannelKind;
  readonly capabilities: ChannelCapabilities;
  send?(message: OutboundChannelMessage): Promise<ChannelSendResult>;
  checkHealth(connection: ChannelConnection): Promise<ChannelHealth>;
  sendTest?(
    connection: ChannelConnection,
    recipient: string
  ): Promise<ChannelSendResult>;
}
