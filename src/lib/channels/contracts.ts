import type {
  ChannelConnection,
  ChannelKind,
  ChannelProvider,
  ContentType,
} from '@/types'

export interface ChannelRecipient {
  contactId: string
  identity: string
  displayName?: string
}

export interface OutboundChannelMessage {
  accountId: string
  connection: ChannelConnection
  recipient: ChannelRecipient
  contentType: ContentType
  text?: string
  html?: string
  subject?: string
  mediaUrl?: string
  replyToExternalMessageId?: string
  idempotencyKey: string
}

export interface ChannelSendResult {
  externalMessageId: string
  externalThreadId?: string
  acceptedAt: string
  providerPayload?: Record<string, unknown>
}

export interface NormalizedInboundMessage {
  provider: ChannelProvider
  channel: ChannelKind
  connectionExternalIdentity: string
  externalEventId: string
  externalMessageId: string
  externalThreadId?: string
  senderIdentity: string
  senderName?: string
  recipientIdentity: string
  subject?: string
  text?: string
  html?: string
  contentType: ContentType
  mediaUrl?: string
  receivedAt: string
  providerPayload: Record<string, unknown>
}

export interface ChannelHealth {
  ok: boolean
  checkedAt: string
  error?: string
}

export interface ChannelAdapter {
  readonly provider: ChannelProvider
  readonly channel: ChannelKind
  send(message: OutboundChannelMessage): Promise<ChannelSendResult>
  checkHealth(connection: ChannelConnection): Promise<ChannelHealth>
}
