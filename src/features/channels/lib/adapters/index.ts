import type { ChannelKind, ChannelProvider } from '@/types'
import type { ChannelAdapter } from '../contracts'
import { MetaWhatsAppAdapter } from './meta'
import { ResendEmailAdapter } from './resend'
import { SmtpEmailAdapter } from './smtp'
import { TwilioWhatsAppAdapter } from './twilio'
import { TwilioSmsAdapter } from './twilio-sms'

/**
 * Adapter factory. `channel` disambiguates multi-channel providers
 * (Twilio serves both WhatsApp and SMS); when omitted, the provider's
 * primary channel is used so existing call sites keep working.
 */
export function createChannelAdapter(
  provider: ChannelProvider,
  channel?: ChannelKind,
): ChannelAdapter | null {
  switch (provider) {
    case 'meta':
      return new MetaWhatsAppAdapter()
    case 'smtp':
      return new SmtpEmailAdapter()
    case 'resend':
      return new ResendEmailAdapter()
    case 'twilio':
      return channel === 'sms' ? new TwilioSmsAdapter() : new TwilioWhatsAppAdapter()
    default:
      return null
  }
}
