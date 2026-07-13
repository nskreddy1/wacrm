import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { channelAdmin } from '@/lib/channels/admin-client'
import { createChannelAdapter } from '@/lib/channels/adapters'
import { encryptProviderCredentials, type ProviderCredentials } from '@/lib/channels/credentials'
import { getProviderCapabilities, isProviderCompatible, PROVIDER_LABEL } from '@/lib/channels/provider-registry'
import type { ChannelConnection, ChannelKind, ChannelProvider } from '@/types'

const providers = ['meta', 'twilio', 'google', 'microsoft', 'resend', 'smtp'] as const
const channels = ['whatsapp', 'email'] as const
const safeColumns = 'id,account_id,created_by_user_id,channel,provider,display_name,external_account_id,external_identity,configuration,status,is_enabled,is_primary,last_connected_at,last_synced_at,last_error,created_at,updated_at'

const saveSchema = z.object({
  action: z.literal('save'),
  id: z.string().uuid().optional(),
  channel: z.enum(channels),
  provider: z.enum(providers),
  displayName: z.string().trim().min(1).max(120),
  externalIdentity: z.string().trim().min(1).max(320),
  configuration: z.record(z.string(), z.unknown()).default({}),
  credentials: z.record(z.string(), z.string()).optional(),
})
const testSchema = z.object({ action: z.literal('test'), id: z.string().uuid(), recipient: z.string().email().optional() })
const patchSchema = z.object({ id: z.string().uuid(), isEnabled: z.boolean().optional(), isPrimary: z.boolean().optional() })

function credentialsFor(provider: ChannelProvider, input?: Record<string, string>): ProviderCredentials | null {
  if (!input) return null
  if (provider === 'smtp') {
    if (!input.username || !input.password) throw new Error('SMTP username and password are required')
    return { provider, value: { username: input.username, password: input.password } }
  }
  if (provider === 'resend') {
    if (!input.apiKey) throw new Error('Resend API key is required')
    return { provider, value: { apiKey: input.apiKey } }
  }
  if (provider === 'twilio') {
    if (!input.accountSid || !input.authToken) throw new Error('Twilio Account SID and Auth Token are required')
    return { provider, value: { accountSid: input.accountSid, authToken: input.authToken } }
  }
  return null
}

function enrich(connection: Record<string, unknown>) {
  const provider = connection.provider as ChannelProvider
  return { ...connection, credentialsConfigured: true, capabilities: getProviderCapabilities(provider), providerLabel: PROVIDER_LABEL[provider] }
}

export async function GET() {
  try {
    const { accountId } = await requireRole('viewer')
    const { data, error } = await channelAdmin().from('channel_connections').select(safeColumns).eq('account_id', accountId).order('channel').order('created_at')
    if (error) throw error
    return NextResponse.json({ connections: (data ?? []).map(enrich), providers: providers.map((provider) => ({ provider, channel: provider === 'meta' || provider === 'twilio' ? 'whatsapp' : 'email', label: PROVIDER_LABEL[provider], capabilities: getProviderCapabilities(provider), available: Boolean(createChannelAdapter(provider)) })) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || !('action' in body)) return NextResponse.json({ error: 'Invalid channel request' }, { status: 400 })

    if (body.action === 'test') {
      const parsed = testSchema.safeParse(body)
      if (!parsed.success) return NextResponse.json({ error: 'Invalid connection test' }, { status: 400 })
      const { data, error } = await channelAdmin().from('channel_connections').select('*').eq('id', parsed.data.id).eq('account_id', accountId).single()
      if (error || !data) return NextResponse.json({ error: 'Channel connection not found' }, { status: 404 })
      const adapter = createChannelAdapter(data.provider as ChannelProvider)
      if (!adapter) return NextResponse.json({ error: `${PROVIDER_LABEL[data.provider as ChannelProvider]} setup is not available yet` }, { status: 409 })
      const health = await adapter.checkHealth(data as ChannelConnection)
      if (!health.ok) {
        await channelAdmin().from('channel_connections').update({ status: 'degraded', is_enabled: false, last_error: health.error }).eq('id', data.id).eq('account_id', accountId)
        return NextResponse.json({ health }, { status: 422 })
      }
      let testMessage
      if (parsed.data.recipient && adapter.sendTest) testMessage = await adapter.sendTest(data as ChannelConnection, parsed.data.recipient)
      await channelAdmin().from('channel_connections').update({ status: 'connected', last_connected_at: health.checkedAt, last_error: null }).eq('id', data.id).eq('account_id', accountId)
      return NextResponse.json({ health, testMessage })
    }

    const parsed = saveSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid channel configuration', details: parsed.error.flatten() }, { status: 400 })
    const { channel, provider } = parsed.data
    if (!isProviderCompatible(channel as ChannelKind, provider as ChannelProvider)) return NextResponse.json({ error: `${provider} is not compatible with ${channel}` }, { status: 400 })
    if (!createChannelAdapter(provider as ChannelProvider)) return NextResponse.json({ error: `${PROVIDER_LABEL[provider as ChannelProvider]} setup is not available in this release` }, { status: 409 })

    const suppliedCredentials = credentialsFor(provider as ChannelProvider, parsed.data.credentials)
    let existing: Record<string, unknown> | null = null
    if (parsed.data.id) {
      const result = await channelAdmin().from('channel_connections').select('*').eq('id', parsed.data.id).eq('account_id', accountId).maybeSingle()
      if (result.error) throw result.error
      existing = result.data
      if (!existing) return NextResponse.json({ error: 'Channel connection not found' }, { status: 404 })
      if (existing.provider !== provider && !suppliedCredentials) return NextResponse.json({ error: 'New credentials are required when switching providers' }, { status: 400 })
    }
    const credentialsEncrypted = suppliedCredentials ? encryptProviderCredentials(suppliedCredentials) : existing?.credentials_encrypted
    if (!credentialsEncrypted) return NextResponse.json({ error: 'Provider credentials are required' }, { status: 400 })

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
    }
    const query = parsed.data.id
      ? channelAdmin().from('channel_connections').update(values).eq('id', parsed.data.id).eq('account_id', accountId)
      : channelAdmin().from('channel_connections').insert(values)
    const { data, error } = await query.select(safeColumns).single()
    if (error) throw error
    return NextResponse.json({ connection: enrich(data) }, { status: parsed.data.id ? 200 : 201 })
  } catch (error) {
    if (error instanceof Error && /required|configuration|Port 587/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 })
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success || (parsed.data.isEnabled === undefined && parsed.data.isPrimary === undefined)) return NextResponse.json({ error: 'Invalid channel connection update' }, { status: 400 })
    const admin = channelAdmin()
    const { data: existing, error } = await admin.from('channel_connections').select('id,channel,status').eq('id', parsed.data.id).eq('account_id', accountId).maybeSingle()
    if (error) throw error
    if (!existing) return NextResponse.json({ error: 'Channel connection not found' }, { status: 404 })
    if (parsed.data.isEnabled && !['connected', 'degraded'].includes(existing.status)) return NextResponse.json({ error: 'Test this provider before enabling it' }, { status: 409 })
    if (parsed.data.isPrimary) await admin.from('channel_connections').update({ is_primary: false }).eq('account_id', accountId).eq('channel', existing.channel).neq('id', existing.id)
    const updates = { ...(parsed.data.isEnabled !== undefined ? { is_enabled: parsed.data.isEnabled } : {}), ...(parsed.data.isPrimary !== undefined ? { is_primary: parsed.data.isPrimary } : {}) }
    const result = await admin.from('channel_connections').update(updates).eq('id', existing.id).eq('account_id', accountId).select(safeColumns).single()
    if (result.error) throw result.error
    return NextResponse.json({ connection: enrich(result.data) })
  } catch (error) {
    return toErrorResponse(error)
  }
}
