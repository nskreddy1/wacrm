import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { channelAdmin } from '@/features/channels/lib/admin-client';
import { createChannelAdapter } from '@/features/channels/lib/adapters';
import {
  buildProviderCredentials,
  decryptProviderCredentials,
  encryptProviderCredentials,
} from '@/features/channels/lib/credentials';
import {
  discoverTwilioAccount,
  isDiscoveryError,
} from '@/features/channels/lib/discovery';
import {
  getProviderCapabilities,
  isProviderCompatible,
  PROVIDER_CHANNELS,
  PROVIDER_LABEL,
} from '@/features/channels/lib/provider-registry';
import type { ChannelConnection, ChannelKind, ChannelProvider } from '@/types';

const providers = [
  'meta',
  'twilio',
  'google',
  'microsoft',
  'resend',
  'smtp',
] as const;
const channels = ['whatsapp', 'sms', 'email'] as const;
const safeColumns =
  'id,account_id,created_by_user_id,channel,provider,display_name,external_account_id,external_identity,configuration,status,is_enabled,is_primary,managed_by,client_can_toggle,platform_notice,last_connected_at,last_synced_at,last_error,created_at,updated_at';

const saveSchema = z.object({
  action: z.literal('save'),
  id: z.string().uuid().optional(),
  channel: z.enum(channels),
  provider: z.enum(providers),
  displayName: z.string().trim().min(1).max(120),
  externalIdentity: z.string().trim().min(1).max(320),
  configuration: z.record(z.string(), z.unknown()).default({}),
  credentials: z.record(z.string(), z.string()).optional(),
  /**
   * Reuse the encrypted credentials of an existing connection (same
   * account, same provider) instead of retyping them — e.g. one Twilio
   * account serving both WhatsApp and SMS. The encrypted blob is
   * copied server-side; secrets never round-trip to the browser.
   */
  reuseCredentialsFromId: z.string().uuid().optional(),
});
const testSchema = z.object({
  action: z.literal('test'),
  id: z.string().uuid(),
  recipient: z.string().email().optional(),
});
const patchSchema = z.object({
  id: z.string().uuid(),
  isEnabled: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});
/**
 * "Validate & Pick": verify Twilio credentials and list the account's
 * numbers/senders/services so the UI offers pickers instead of manual
 * SID copying. Credentials come either fresh from the form or from an
 * existing connection (decrypted server-side, never sent to browser).
 */
const discoverSchema = z.object({
  action: z.literal('discover'),
  provider: z.literal('twilio'),
  accountSid: z.string().trim().optional(),
  authToken: z.string().trim().optional(),
  reuseCredentialsFromId: z.string().uuid().optional(),
});

function enrich(connection: Record<string, unknown>) {
  const provider = connection.provider as ChannelProvider;
  const channel = connection.channel as ChannelKind;
  return {
    ...connection,
    credentialsConfigured: true,
    capabilities: getProviderCapabilities(provider, channel),
    providerLabel: PROVIDER_LABEL[provider],
  };
}

export async function GET() {
  try {
    const { accountId } = await requireRole('viewer');
    const { data, error } = await channelAdmin()
      .from('channel_connections')
      .select(safeColumns)
      .eq('account_id', accountId)
      .order('channel')
      .order('created_at');
    if (error) throw error;
    // One offering per provider+channel pair — multi-channel providers
    // (Twilio: WhatsApp + SMS) appear once per channel they serve.
    const offerings = providers.flatMap((provider) =>
      PROVIDER_CHANNELS[provider].map((channel) => ({
        provider,
        channel,
        label: PROVIDER_LABEL[provider],
        capabilities: getProviderCapabilities(provider, channel),
        available: Boolean(createChannelAdapter(provider, channel)),
      }))
    );
    // Guided one-click connect availability. Twilio Connect needs a
    // Connect App SID (Twilio Console → Settings → Connect apps).
    // WhatsApp Embedded Signup additionally needs Meta Tech Provider
    // approval — scaffolded so the button lights up once configured.
    const guidedConnect = {
      twilio: {
        configured: Boolean(process.env.TWILIO_CONNECT_APP_SID),
        authorizeUrl: process.env.TWILIO_CONNECT_APP_SID
          ? `https://www.twilio.com/authorize/${process.env.TWILIO_CONNECT_APP_SID}`
          : null,
      },
      whatsappEmbeddedSignup: {
        configured: Boolean(
          process.env.META_APP_ID && process.env.META_SIGNUP_CONFIG_ID
        ),
      },
    };
    return NextResponse.json({
      connections: (data ?? []).map(enrich),
      providers: offerings,
      guidedConnect,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');
    // Save + test both hit external provider APIs (Twilio health check,
    // SMTP handshake) — bound the rate per user like /api/whatsapp/config.
    const limit = checkRateLimit(
      `config:${userId}`,
      RATE_LIMITS.configMutation
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || !('action' in body))
      return NextResponse.json(
        { error: 'Invalid channel request' },
        { status: 400 }
      );

    if (body.action === 'discover') {
      const parsed = discoverSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json(
          { error: 'Invalid discovery request' },
          { status: 400 }
        );
      let sid = parsed.data.accountSid;
      let token = parsed.data.authToken;
      // Reuse credentials from an existing connection server-side —
      // secrets never round-trip to the browser.
      if ((!sid || !token) && parsed.data.reuseCredentialsFromId) {
        const source = await channelAdmin()
          .from('channel_connections')
          .select('provider,credentials_encrypted')
          .eq('id', parsed.data.reuseCredentialsFromId)
          .eq('account_id', accountId)
          .maybeSingle();
        if (source.error) throw source.error;
        if (!source.data || source.data.provider !== 'twilio') {
          return NextResponse.json(
            { error: 'No Twilio connection found to reuse credentials from' },
            { status: 404 }
          );
        }
        const decrypted = decryptProviderCredentials(
          source.data as ChannelConnection & { credentials_encrypted?: string }
        );
        if (decrypted.provider !== 'twilio')
          return NextResponse.json(
            { error: 'Stored credentials are not Twilio credentials' },
            { status: 400 }
          );
        sid = decrypted.value.accountSid;
        token = decrypted.value.authToken;
      }
      if (!sid || !token)
        return NextResponse.json(
          { error: 'Twilio Account SID and Auth token are required' },
          { status: 400 }
        );
      const discovery = await discoverTwilioAccount(sid, token);
      return NextResponse.json({ discovery });
    }

    if (body.action === 'test') {
      const parsed = testSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json(
          { error: 'Invalid connection test' },
          { status: 400 }
        );
      const { data, error } = await channelAdmin()
        .from('channel_connections')
        .select('*')
        .eq('id', parsed.data.id)
        .eq('account_id', accountId)
        .single();
      if (error || !data)
        return NextResponse.json(
          { error: 'Channel connection not found' },
          { status: 404 }
        );
      const adapter = createChannelAdapter(
        data.provider as ChannelProvider,
        data.channel as ChannelKind
      );
      if (!adapter)
        return NextResponse.json(
          {
            error: `${PROVIDER_LABEL[data.provider as ChannelProvider]} setup is not available yet`,
          },
          { status: 409 }
        );
      const health = await adapter.checkHealth(data as ChannelConnection);
      if (!health.ok) {
        await channelAdmin()
          .from('channel_connections')
          .update({
            status: 'degraded',
            is_enabled: false,
            last_error: health.error,
          })
          .eq('id', data.id)
          .eq('account_id', accountId);
        return NextResponse.json({ health }, { status: 422 });
      }
      let testMessage;
      if (parsed.data.recipient && adapter.sendTest)
        testMessage = await adapter.sendTest(
          data as ChannelConnection,
          parsed.data.recipient
        );
      await channelAdmin()
        .from('channel_connections')
        .update({
          status: 'connected',
          last_connected_at: health.checkedAt,
          last_error: null,
        })
        .eq('id', data.id)
        .eq('account_id', accountId);
      return NextResponse.json({ health, testMessage });
    }

    const parsed = saveSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        {
          error: 'Invalid channel configuration',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    const { channel, provider } = parsed.data;
    if (
      !isProviderCompatible(channel as ChannelKind, provider as ChannelProvider)
    )
      return NextResponse.json(
        { error: `${provider} is not compatible with ${channel}` },
        { status: 400 }
      );
    if (
      !createChannelAdapter(provider as ChannelProvider, channel as ChannelKind)
    )
      return NextResponse.json(
        {
          error: `${PROVIDER_LABEL[provider as ChannelProvider]} setup is not available in this release`,
        },
        { status: 409 }
      );

    const suppliedCredentials = buildProviderCredentials(
      provider,
      parsed.data.credentials
    );
    let existing: Record<string, unknown> | null = null;
    if (parsed.data.id) {
      const result = await channelAdmin()
        .from('channel_connections')
        .select('*')
        .eq('id', parsed.data.id)
        .eq('account_id', accountId)
        .maybeSingle();
      if (result.error) throw result.error;
      existing = result.data;
      if (!existing)
        return NextResponse.json(
          { error: 'Channel connection not found' },
          { status: 404 }
        );
      // Platform-managed connections are provisioned by the platform
      // team from the admin console — workspaces can enable/disable
      // them (PATCH) but never edit credentials or configuration.
      if (existing.managed_by === 'platform') {
        return NextResponse.json(
          {
            error:
              'This connection is managed by the platform team. Contact support to change it.',
          },
          { status: 403 }
        );
      }
      if (existing.provider !== provider && !suppliedCredentials)
        return NextResponse.json(
          { error: 'New credentials are required when switching providers' },
          { status: 400 }
        );
    }
    // Credential precedence: freshly supplied > reused from a sibling
    // connection > kept from the row being edited.
    let reusedCredentials: string | undefined;
    if (!suppliedCredentials && parsed.data.reuseCredentialsFromId) {
      const source = await channelAdmin()
        .from('channel_connections')
        .select('provider,credentials_encrypted')
        .eq('id', parsed.data.reuseCredentialsFromId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (source.error) throw source.error;
      if (!source.data)
        return NextResponse.json(
          { error: 'The connection to reuse credentials from was not found' },
          { status: 404 }
        );
      if (source.data.provider !== provider)
        return NextResponse.json(
          {
            error:
              'Credentials can only be reused between connections of the same provider',
          },
          { status: 400 }
        );
      reusedCredentials = source.data.credentials_encrypted as string;
    }
    const credentialsEncrypted = suppliedCredentials
      ? encryptProviderCredentials(suppliedCredentials)
      : (reusedCredentials ?? existing?.credentials_encrypted);
    if (!credentialsEncrypted)
      return NextResponse.json(
        { error: 'Provider credentials are required' },
        { status: 400 }
      );

    const values = {
      account_id: accountId,
      created_by_user_id: userId,
      channel,
      provider,
      display_name: parsed.data.displayName,
      external_identity: parsed.data.externalIdentity,
      configuration: parsed.data.configuration,
      credentials_encrypted: credentialsEncrypted,
      status: 'draft',
      is_enabled: false,
      last_error: null,
    };
    const query = parsed.data.id
      ? channelAdmin()
          .from('channel_connections')
          .update(values)
          .eq('id', parsed.data.id)
          .eq('account_id', accountId)
      : channelAdmin().from('channel_connections').insert(values);
    const { data, error } = await query.select(safeColumns).single();
    if (error) throw error;
    return NextResponse.json(
      { connection: enrich(data) },
      { status: parsed.data.id ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENCRYPTION_KEY')) {
      // Server misconfiguration, not a client error — tell the admin
      // exactly what to fix instead of an opaque 500.
      console.error(
        '[settings/channels] ENCRYPTION_KEY misconfigured:',
        error.message
      );
      return NextResponse.json(
        {
          error:
            'Server is missing the ENCRYPTION_KEY environment variable (64-char hex). Add it to the deployment and retry.',
        },
        { status: 503 }
      );
    }
    // Discovery failures carry their upstream HTTP status (401 bad
    // credentials, 400 malformed SID) — surface the message directly.
    if (isDiscoveryError(error))
      return NextResponse.json(
        { error: error.message },
        { status: error.status >= 500 ? 502 : error.status }
      );
    if (
      error instanceof Error &&
      /required|configuration|Port 587/.test(error.message)
    )
      return NextResponse.json({ error: error.message }, { status: 400 });
    // Postgres unique violation (23505): same sender identity already
    // connected for this channel+provider — a 409, not an opaque 500.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      return NextResponse.json(
        {
          error:
            'A connection with this sender number/email already exists for this channel. Edit the existing connection instead of adding a duplicate.',
        },
        { status: 409 }
      );
    }
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');
    // Same bucket as POST — enable/primary toggles are config mutations.
    const limit = checkRateLimit(
      `config:${userId}`,
      RATE_LIMITS.configMutation
    );
    if (!limit.success) return rateLimitResponse(limit);
    const parsed = patchSchema.safeParse(await request.json());
    if (
      !parsed.success ||
      (parsed.data.isEnabled === undefined &&
        parsed.data.isPrimary === undefined)
    )
      return NextResponse.json(
        { error: 'Invalid channel connection update' },
        { status: 400 }
      );
    const admin = channelAdmin();
    const { data: existing, error } = await admin
      .from('channel_connections')
      .select('id,channel,status,managed_by,client_can_toggle,platform_notice')
      .eq('id', parsed.data.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!existing)
      return NextResponse.json(
        { error: 'Channel connection not found' },
        { status: 404 }
      );
    // Platform governance: support can lock the enable/disable toggle
    // (e.g. while a Twilio number is under carrier review). Surface
    // their notice as the reason instead of a generic error.
    if (
      parsed.data.isEnabled !== undefined &&
      existing.managed_by === 'platform' &&
      existing.client_can_toggle === false
    ) {
      return NextResponse.json(
        {
          error: existing.platform_notice?.trim()
            ? existing.platform_notice
            : 'This connection is temporarily locked by our support team. Contact support for details.',
          locked: true,
        },
        { status: 403 }
      );
    }
    if (
      parsed.data.isEnabled &&
      !['connected', 'degraded'].includes(existing.status)
    )
      return NextResponse.json(
        { error: 'Test this provider before enabling it' },
        { status: 409 }
      );
    if (parsed.data.isPrimary)
      await admin
        .from('channel_connections')
        .update({ is_primary: false })
        .eq('account_id', accountId)
        .eq('channel', existing.channel)
        .neq('id', existing.id);
    const updates = {
      ...(parsed.data.isEnabled !== undefined
        ? { is_enabled: parsed.data.isEnabled }
        : {}),
      ...(parsed.data.isPrimary !== undefined
        ? { is_primary: parsed.data.isPrimary }
        : {}),
    };
    const result = await admin
      .from('channel_connections')
      .update(updates)
      .eq('id', existing.id)
      .eq('account_id', accountId)
      .select(safeColumns)
      .single();
    if (result.error) throw result.error;
    return NextResponse.json({ connection: enrich(result.data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
