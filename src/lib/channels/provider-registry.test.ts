import { beforeEach, describe, expect, it } from 'vitest'
import type { ChannelAdapter } from './contracts'
import {
  clearChannelAdaptersForTests,
  getChannelAdapter,
  hasChannelAdapter,
  registerChannelAdapter,
} from './provider-registry'

const metaAdapter: ChannelAdapter = {
  provider: 'meta',
  channel: 'whatsapp',
  async send() {
    return { externalMessageId: 'wamid.1', acceptedAt: new Date(0).toISOString() }
  },
  async checkHealth() {
    return { ok: true, checkedAt: new Date(0).toISOString() }
  },
}

describe('channel provider registry', () => {
  beforeEach(() => clearChannelAdaptersForTests())

  it('registers and resolves an adapter', () => {
    registerChannelAdapter(metaAdapter)
    expect(hasChannelAdapter('meta')).toBe(true)
    expect(getChannelAdapter('meta')).toBe(metaAdapter)
  })

  it('rejects accidental replacement', () => {
    registerChannelAdapter(metaAdapter)
    expect(() => registerChannelAdapter({ ...metaAdapter })).toThrow(
      'already registered',
    )
  })

  it('fails clearly when a provider is not configured', () => {
    expect(() => getChannelAdapter('google')).toThrow(
      'No channel adapter is registered for google',
    )
  })
})
