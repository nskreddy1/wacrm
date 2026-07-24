import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelAdapter } from './contracts';
import {
  clearChannelAdaptersForTests,
  getChannelAdapter,
  getProviderCapabilities,
  hasChannelAdapter,
  isProviderCompatible,
  registerChannelAdapter,
} from './provider-registry';

const metaAdapter: ChannelAdapter = {
  provider: 'meta',
  channel: 'whatsapp',
  capabilities: {
    send: true,
    receive: true,
    healthCheck: true,
    oauth: false,
    testMessage: false,
  },
  async send() {
    return {
      externalMessageId: 'wamid.1',
      acceptedAt: new Date(0).toISOString(),
    };
  },
  async checkHealth() {
    return { ok: true, checkedAt: new Date(0).toISOString() };
  },
};

describe('channel provider registry', () => {
  beforeEach(() => clearChannelAdaptersForTests());

  it('registers and resolves by channel and provider', () => {
    registerChannelAdapter(metaAdapter);
    expect(hasChannelAdapter('meta')).toBe(true);
    expect(getChannelAdapter('whatsapp', 'meta')).toBe(metaAdapter);
    expect(getProviderCapabilities('meta').receive).toBe(true);
  });

  it('rejects accidental replacement', () => {
    registerChannelAdapter(metaAdapter);
    expect(() => registerChannelAdapter({ ...metaAdapter })).toThrow(
      'already registered'
    );
  });

  it('rejects incompatible channel/provider pairs', () => {
    expect(isProviderCompatible('email', 'twilio')).toBe(false);
    expect(() => getChannelAdapter('email', 'twilio')).toThrow(
      'not compatible'
    );
  });

  it('fails clearly when a provider is not configured', () => {
    expect(() => getChannelAdapter('email', 'google')).toThrow(
      'No channel adapter is registered for google'
    );
  });
});
