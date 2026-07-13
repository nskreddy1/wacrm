import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import type { ChannelConnection } from '@/types'

export interface TwilioCredentials {
  accountSid: string
  authToken: string
}

export interface GoogleCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export interface ResendCredentials {
  apiKey: string
}

export type ProviderCredentials =
  | { provider: 'twilio'; value: TwilioCredentials }
  | { provider: 'google'; value: GoogleCredentials }
  | { provider: 'resend'; value: ResendCredentials }

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
