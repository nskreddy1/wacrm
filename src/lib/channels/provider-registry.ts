import type { ChannelProvider } from '@/types'
import type { ChannelAdapter } from './contracts'

const adapters = new Map<ChannelProvider, ChannelAdapter>()

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  const existing = adapters.get(adapter.provider)
  if (existing && existing !== adapter) {
    throw new Error(`A channel adapter is already registered for ${adapter.provider}`)
  }
  adapters.set(adapter.provider, adapter)
}

export function getChannelAdapter(provider: ChannelProvider): ChannelAdapter {
  const adapter = adapters.get(provider)
  if (!adapter) {
    throw new Error(`No channel adapter is registered for ${provider}`)
  }
  return adapter
}

export function hasChannelAdapter(provider: ChannelProvider): boolean {
  return adapters.has(provider)
}

export function clearChannelAdaptersForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Channel adapters can only be cleared in tests')
  }
  adapters.clear()
}
