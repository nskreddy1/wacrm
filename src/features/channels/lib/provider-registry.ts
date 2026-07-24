import type { ChannelKind, ChannelProvider } from '@/types';
import type { ChannelAdapter, ChannelCapabilities } from './contracts';

const adapters = new Map<string, ChannelAdapter>();

/**
 * Channels each provider can serve. A provider may power more than
 * one channel (Twilio does WhatsApp and SMS); the first entry is the
 * provider's primary channel, used when no channel is specified.
 */
export const PROVIDER_CHANNELS: Record<ChannelProvider, ChannelKind[]> = {
  meta: ['whatsapp'],
  twilio: ['whatsapp', 'sms'],
  google: ['email'],
  microsoft: ['email'],
  resend: ['email'],
  smtp: ['email'],
};

export const PROVIDER_LABEL: Record<ChannelProvider, string> = {
  meta: 'Meta Cloud API',
  twilio: 'Twilio',
  google: 'Gmail',
  microsoft: 'Microsoft 365',
  resend: 'Resend',
  smtp: 'SMTP',
};

const unavailableCapabilities: ChannelCapabilities = {
  send: false,
  receive: false,
  healthCheck: false,
  oauth: false,
  testMessage: false,
};

function key(channel: ChannelKind, provider: ChannelProvider) {
  return `${channel}:${provider}`;
}

export function isProviderCompatible(
  channel: ChannelKind,
  provider: ChannelProvider
): boolean {
  return PROVIDER_CHANNELS[provider].includes(channel);
}

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  if (!isProviderCompatible(adapter.channel, adapter.provider)) {
    throw new Error(
      `${adapter.provider} is not compatible with ${adapter.channel}`
    );
  }
  const adapterKey = key(adapter.channel, adapter.provider);
  const existing = adapters.get(adapterKey);
  if (existing && existing !== adapter) {
    throw new Error(
      `A channel adapter is already registered for ${adapter.provider} on ${adapter.channel}`
    );
  }
  adapters.set(adapterKey, adapter);
}

export function getChannelAdapter(
  channel: ChannelKind,
  provider: ChannelProvider
): ChannelAdapter {
  if (!isProviderCompatible(channel, provider)) {
    throw new Error(`${provider} is not compatible with ${channel}`);
  }
  const adapter = adapters.get(key(channel, provider));
  if (!adapter)
    throw new Error(
      `No channel adapter is registered for ${provider} on ${channel}`
    );
  return adapter;
}

/** Whether an adapter is registered for the provider (any channel, or a specific one). */
export function hasChannelAdapter(
  provider: ChannelProvider,
  channel?: ChannelKind
): boolean {
  const channels = channel ? [channel] : PROVIDER_CHANNELS[provider];
  return channels.some((c) => adapters.has(key(c, provider)));
}

/**
 * Capabilities for a provider on a channel. Defaults to the
 * provider's primary channel to preserve existing call sites.
 */
export function getProviderCapabilities(
  provider: ChannelProvider,
  channel?: ChannelKind
): ChannelCapabilities {
  const resolved = channel ?? PROVIDER_CHANNELS[provider][0];
  return (
    adapters.get(key(resolved, provider))?.capabilities ??
    unavailableCapabilities
  );
}

export function clearChannelAdaptersForTests(): void {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Channel adapters can only be cleared in tests');
  adapters.clear();
}
