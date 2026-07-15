import type { ChannelProvider } from '@/types'
import type { ChannelAdapter } from '../contracts'
import { MetaWhatsAppAdapter } from './meta'
import { ResendEmailAdapter } from './resend'
import { SmtpEmailAdapter } from './smtp'
import { TwilioWhatsAppAdapter } from './twilio'

export function createChannelAdapter(provider: ChannelProvider): ChannelAdapter | null {
  switch (provider) {
    case 'meta':
      return new MetaWhatsAppAdapter()
    case 'smtp':
      return new SmtpEmailAdapter()
    case 'resend':
      return new ResendEmailAdapter()
    case 'twilio':
      return new TwilioWhatsAppAdapter()
    default:
      return null
  }
}
