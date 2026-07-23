import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import type { ChannelConnection } from '@/types'

export interface TwilioCredentials {
  accountSid: string
  authToken: string
  /**
   * Optional Twilio Messaging Service SID (MG…). When set, SMS sends
   * use MessagingServiceSid instead of a bare From number, which
   * enables Twilio-managed sender pooling, Sticky Sender, Advanced
   * Opt-Out, and geomatch (docs: /docs/messaging/services). The
   * connection's external_identity remains the fallback From sender.
   */
  messagingServiceSid?: string
}

export interface GoogleCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export interface ResendCredentials {
  apiKey: string
}

export interface SmtpCredentials {
  username: string
  password: string
}

export interface MetaCredentials {
  accessToken: string
  appSecret: string
  verifyToken: string
}

export type ProviderCredentials =
  | { provider: 'twilio'; value: TwilioCredentials }
  | { provider: 'google'; value: GoogleCredentials }
  | { provider: 'resend'; value: ResendCredentials }
  | { provider: 'smtp'; value: SmtpCredentials }
  | { provider: 'meta'; value: MetaCredentials }

/**
 * Build a typed ProviderCredentials from raw form input. Shared by the
 * workspace settings route and the platform admin route so validation
 * rules stay identical no matter who provisions the connection.
 * Returns null when input is absent; throws on invalid shapes.
 */
export function buildProviderCredentials(
  provider: string,
  input?: Record<string, string>,
): ProviderCredentials | null {
  if (!input) return null
  if (provider === 'smtp') {
    if (!input.username || !input.password) throw new Error('SMTP username and password are required')
    return { provider: 'smtp', value: { username: input.username, password: input.password } }
  }
  if (provider === 'resend') {
    if (!input.apiKey) throw new Error('Resend API key is required')
    return { provider: 'resend', value: { apiKey: input.apiKey } }
  }
  if (provider === 'meta') {
    // WhatsApp Cloud API (direct Meta connection). Only the access
    // token is required to send; app secret + verify token power
    // webhook signature validation and can be added later.
    if (!input.accessToken) throw new Error('Meta permanent access token is required')
    return {
      provider: 'meta',
      value: {
        accessToken: input.accessToken,
        appSecret: input.appSecret ?? '',
        verifyToken: input.verifyToken ?? '',
      },
    }
  }
  if (provider === 'twilio') {
    if (!input.accountSid || !input.authToken) throw new Error('Twilio Account SID and Auth Token are required')
    // Optional Messaging Service SID (MG…) — enables Twilio-managed
    // sender pooling, Sticky Sender, and Advanced Opt-Out for SMS.
    const messagingServiceSid = input.messagingServiceSid?.trim()
    if (messagingServiceSid && !/^MG[0-9a-fA-F]{32}$/.test(messagingServiceSid)) {
      throw new Error('Messaging Service SID must look like MG… (34 characters)')
    }
    return {
      provider: 'twilio',
      value: {
        accountSid: input.accountSid,
        authToken: input.authToken,
        ...(messagingServiceSid ? { messagingServiceSid } : {}),
      },
    }
  }
  return null
}

function parseCredentials(value: string): ProviderCredentials {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || !('provider' in parsed) || !('value' in parsed)) {
    throw new Error('Provider credentials have an invalid shape')
  }
  return parsed as ProviderCredentials
}

export function encryptProviderCredentials(credentials: ProviderCredentials): string {
  return encrypt(JSON.stringify(credentials))
}

export function decryptProviderCredentials(
  connection: ChannelConnection & { credentials_encrypted?: string },
): ProviderCredentials {
  if (!connection.credentials_encrypted) {
    throw new Error(`${connection.provider} credentials are not configured`)
  }
  const credentials = parseCredentials(decrypt(connection.credentials_encrypted))
  if (credentials.provider !== connection.provider) {
    throw new Error('Provider credentials do not match the channel connection')
  }
  return credentials
}
