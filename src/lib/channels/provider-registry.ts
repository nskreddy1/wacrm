import type { ChannelKind, ChannelProvider } from '@/types'
import type { ChannelAdapter, ChannelCapabilities } from './contracts'

const adapters = new Map<string, ChannelAdapter>()

export const PROVIDER_CHANNEL: Record<ChannelProvider, ChannelKind> = {
  meta: 'whatsapp',
  twilio: 'whatsapp',
  google: 'email',
  microsoft: 'email',
  resend: 'email',
  smtp: 'email',
}

export const PROVIDER_LABEL: Record<ChannelProvider, string> = {
  meta: 'Meta Cloud API',
  twilio: 'Twilio',
  google: 'Gmail',
  microsoft: 'Microsoft 365',
  resend: 'Resend',
  smtp: 'SMTP',
}

const unavailableCapabilities: ChannelCapabilities = {
  send: false,
  receive: false,
  healthCheck: false,
  oauth: false,
  testMessage: false,
}

function key(channel: ChannelKind, provider: ChannelProvider) {
  return `${channel}:${provider}`
}

export function isProviderCompatible(channel: ChannelKind, provider: ChannelProvider): boolean {
  return PROVIDER_CHANNEL[provider] === channel
}

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  if (!isProviderCompatible(adapter.channel, adapter.provider)) {
    throw new Error(`${adapter.provider} is not compatible with ${adapter.channel}`)
  }
  const adapterKey = key(adapter.channel, adapter.provider)
  const existing = adapters.get(adapterKey)
  if (existing && existing !== adapter) {
    throw new Error(`A channel adapter is already registered for ${adapter.provider}`)
  }
  adapters.set(adapterKey, adapter)
}

export function getChannelAdapter(channel: ChannelKind, provider: ChannelProvider): ChannelAdapter {
  if (!isProviderCompatible(channel, provider)) {
    throw new Error(`${provider} is not compatible with ${channel}`)
  }
  const adapter = adapters.get(key(channel, provider))
  if (!adapter) throw new Error(`No channel adapter is registered for ${provider}`)
  return adapter
}

export function hasChannelAdapter(provider: ChannelProvider): boolean {
  return adapters.has(key(PROVIDER_CHANNEL[provider], provider))
}

export function getProviderCapabilities(provider: ChannelProvider): ChannelCapabilities {
  return adapters.get(key(PROVIDER_CHANNEL[provider], provider))?.capabilities ?? unavailableCapabilities
}

export function clearChannelAdaptersForTests(): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Channel adapters can only be cleared in tests')
  adapters.clear()
}
