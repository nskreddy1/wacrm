'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { CheckCircle2, Loader2, Mail, MessageCircle, ShieldCheck, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsPanelHead } from './settings-panel-head'
import type { ChannelConnection, ChannelKind, ChannelProvider } from '@/types'

type ProviderInfo = { provider: ChannelProvider; channel: ChannelKind; label: string; available: boolean }
type Connection = ChannelConnection & { credentialsConfigured: boolean; providerLabel: string }
type ResponseData = { connections: Connection[]; providers: ProviderInfo[] }
const fetcher = async (url: string) => {
  const response = await fetch(url)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error ?? 'Could not load channel connections')
  return payload
}

const defaults = {
  displayName: '', externalIdentity: '', host: '', port: '587', username: '', password: '', apiKey: '', accountSid: '', authToken: '', messagingServiceSid: '', recipient: '',
}

/**
 * Per-channel copy and requirements: WhatsApp is a policy-governed
 * channel (Meta template approval, 24h session window), SMS is
 * carrier-based pay-per-segment, Email is free-form. Splitting them
 * keeps each panel's guidance specific instead of
 * lowest-common-denominator. Rendered Bigin-style: a centered connect
 * hero plus an amber "Requirements" callout.
 */
const CHANNEL_HEAD: Record<
  ChannelKind,
  { title: string; heroTitle: string; description: string; requirements: string[] }
> = {
  whatsapp: {
    title: 'WhatsApp',
    heroTitle: 'Connect your WhatsApp Business account',
    description:
      'Link your WhatsApp Business number to engage customers in conversations, broadcasts, and automations. Manage message templates in the Template studio.',
    requirements: [
      'You need a Twilio account with a WhatsApp-enabled sender number.',
      'Outbound messages outside the 24-hour customer service window require Meta-approved templates.',
      'Customer opt-in is mandatory under WhatsApp Business policy — collect consent before messaging.',
      'Understand WhatsApp\u2019s conversation-based pricing before large sends.',
    ],
  },
  sms: {
    title: 'SMS',
    heroTitle: 'Connect your SMS provider',
    description:
      'Link an SMS provider to reach customers by text for conversations and broadcasts. No template pre-approval is needed.',
    requirements: [
      'You need a Twilio account with an SMS-capable phone number.',
      'SMS is billed per segment — check regional pricing before large sends.',
      'Regional sender-ID and opt-out (STOP) regulations apply to marketing texts.',
      'A Messaging Service is recommended for sender pooling and carrier-managed opt-outs.',
    ],
  },
  email: {
    title: 'Email',
    heroTitle: 'Connect your email provider',
    description:
      'Link an email provider for conversations and broadcasts. Email is free-form — no external approval is needed.',
    requirements: [
      'You need SMTP credentials or a Resend API key.',
      'Use a dedicated sender address (e.g. support@yourdomain.com).',
      'Set up SPF and DKIM on your domain for reliable deliverability.',
      'Send a test message before enabling the connection.',
    ],
  },
}

export function ChannelConnections({ fixedChannel }: { fixedChannel?: ChannelKind }) {
  const { data, error, isLoading, mutate } = useSWR<ResponseData>('/api/settings/channels', fetcher)
  const [channel, setChannel] = useState<ChannelKind>(fixedChannel ?? 'email')
  const [provider, setProvider] = useState<ChannelProvider>(fixedChannel && fixedChannel !== 'email' ? 'twilio' : 'smtp')
  const [form, setForm] = useState(defaults)
  const [busy, setBusy] = useState<string | null>(null)
  const [reuseFromId, setReuseFromId] = useState<string | null>(null)
  const connections = useMemo(() => data?.connections.filter((item) => item.channel === channel) ?? [], [data, channel])
  const providers = data?.providers.filter((item) => item.channel === channel) ?? []
  // An existing Twilio connection on ANOTHER channel whose credentials
  // can be reused (one Twilio account often serves WhatsApp + SMS).
  const reusableTwilio = useMemo(
    () => (provider === 'twilio' ? data?.connections.find((item) => item.provider === 'twilio' && item.channel !== channel) ?? null : null),
    [data, provider, channel],
  )

  function update(name: keyof typeof defaults, value: string) { setForm((current) => ({ ...current, [name]: value })) }

  async function request(body: unknown, method = 'POST') {
    const response = await fetch('/api/settings/channels', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json()
    if (!response.ok) {
      // Surface the first field-level validation issue (Zod flatten())
      // instead of the generic top-level error when available.
      const fieldErrors = payload.details?.fieldErrors as Record<string, string[]> | undefined
      const firstField = fieldErrors ? Object.entries(fieldErrors).find(([, messages]) => messages.length > 0) : undefined
      const detail = firstField ? `${firstField[0]}: ${firstField[1][0]}` : undefined
      throw new Error(detail ?? payload.error ?? 'Channel operation failed')
    }
    await mutate()
    return payload
  }

  async function save() {
    // Client-side validation mirroring the API's saveSchema, so users
    // get a specific message instead of "Invalid channel configuration".
    const identityLabel = channel === 'email' ? 'sender email' : channel === 'sms' ? 'SMS number' : 'WhatsApp number'
    if (!form.displayName.trim()) { toast.error('Connection name is required.'); return }
    if (!form.externalIdentity.trim()) { toast.error(`The ${identityLabel} is required.`); return }
    if (provider === 'twilio' && !reuseFromId && (!form.accountSid.trim() || !form.authToken.trim())) { toast.error('Twilio Account SID and Auth token are required.'); return }
    if (provider === 'smtp' && (!form.host.trim() || !form.username.trim() || !form.password.trim())) { toast.error('SMTP host, username, and password are required.'); return }
    if (provider === 'resend' && !form.apiKey.trim()) { toast.error('Resend API key is required.'); return }
    setBusy('save')
    try {
      const configuration = provider === 'smtp' ? { host: form.host, port: Number(form.port), secure: Number(form.port) === 465, requireTls: Number(form.port) === 587 } : {}
      const reusing = provider === 'twilio' && Boolean(reuseFromId)
      const credentials = reusing ? undefined : provider === 'smtp' ? { username: form.username, password: form.password } : provider === 'resend' ? { apiKey: form.apiKey } : provider === 'twilio' ? { accountSid: form.accountSid, authToken: form.authToken, ...(form.messagingServiceSid.trim() ? { messagingServiceSid: form.messagingServiceSid.trim() } : {}) } : undefined
      await request({ action: 'save', channel, provider, displayName: form.displayName.trim(), externalIdentity: form.externalIdentity.trim(), configuration, credentials, ...(reusing ? { reuseCredentialsFromId: reuseFromId } : {}) })
      setForm(defaults)
      setReuseFromId(null)
      toast.success('Provider credentials saved securely. Test the connection before enabling it.')
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not save provider') } finally { setBusy(null) }
  }

  async function test(connection: Connection) {
    setBusy(`test-${connection.id}`)
    try {
      await request({ action: 'test', id: connection.id, recipient: channel === 'email' ? form.recipient || undefined : undefined })
      toast.success(form.recipient ? 'Connection verified and test message sent.' : 'Connection verified.')
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Connection test failed') } finally { setBusy(null) }
  }

  async function toggle(connection: Connection, enabled: boolean) {
    setBusy(`toggle-${connection.id}`)
    try { await request({ id: connection.id, isEnabled: enabled, isPrimary: enabled ? true : undefined }, 'PATCH'); toast.success(enabled ? 'Provider enabled.' : 'Provider disabled.') }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not update provider') } finally { setBusy(null) }
  }

  const visibleChannels: ChannelKind[] = fixedChannel ? [fixedChannel] : ['email', 'whatsapp', 'sms']
  const hero = fixedChannel ? CHANNEL_HEAD[fixedChannel] : null
  const HeroIcon = fixedChannel === 'whatsapp' ? MessageCircle : fixedChannel === 'sms' ? Smartphone : Mail

  return (
    <section>
      {hero ? (
        /* Bigin-style connect hero: centered title, channel mark,
           short description, then an amber Requirements callout. */
        <div className="mb-6 flex flex-col items-center gap-4 pt-2 text-center">
          <h2 className="text-2xl font-bold text-balance text-foreground">{hero.heroTitle}</h2>
          <div className="flex size-14 items-center justify-center rounded-full bg-primary-soft">
            <HeroIcon className="size-7 text-primary" aria-hidden />
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground">{hero.description}</p>
          <div className="w-full max-w-2xl rounded-lg bg-amber-500/10 px-5 py-4 text-left">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Requirements</h3>
            <ul className="flex flex-col gap-1.5">
              {hero.requirements.map((requirement) => (
                <li key={requirement} className="flex gap-2.5 text-sm leading-relaxed text-foreground/85">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/60" />
                  {requirement}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <>
          <SettingsPanelHead title="Channels" description="Connect email, WhatsApp, and SMS providers without changing how conversations work. Each channel is independent — a school can run SMS-only broadcasts without ever connecting WhatsApp. Providers are configured, tested, and enabled per channel, so future providers slot in beside the existing ones." />
          <Alert className="mb-5">
            <ShieldCheck />
            <AlertTitle>Provider-neutral and secret-safe</AlertTitle>
            <AlertDescription>Credentials are encrypted at rest and never returned to this browser. Switching providers requires deliberate setup and a successful health check.</AlertDescription>
          </Alert>
        </>
      )}
      {/* Reset the draft form when switching channel tabs — each tab is
          an independent connection draft, so values typed for WhatsApp
          must not leak into the SMS form. */}
      <Tabs value={channel} onValueChange={(value) => { const next = value as ChannelKind; setChannel(next); setProvider(next === 'email' ? 'smtp' : 'twilio'); setForm(defaults); setReuseFromId(null) }}>
        {fixedChannel ? null : (
          <TabsList>
            <TabsTrigger value="email"><Mail />Email</TabsTrigger>
            <TabsTrigger value="whatsapp"><MessageCircle />WhatsApp</TabsTrigger>
            <TabsTrigger value="sms"><Smartphone />SMS</TabsTrigger>
          </TabsList>
        )}
        {visibleChannels.map((tab) => (
          <TabsContent key={tab} value={tab} className="flex flex-col gap-5 pt-4">
            {isLoading ? <Card><CardContent className="flex items-center justify-center py-12"><Loader2 className="animate-spin" /><span className="sr-only">Loading connections</span></CardContent></Card> : null}
            {error ? <Alert variant="destructive"><AlertTitle>Connections unavailable</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert> : null}
            {connections.map((connection) => (
              <Card key={connection.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1"><CardTitle>{connection.display_name}</CardTitle><CardDescription>{connection.providerLabel} · {connection.external_identity}</CardDescription></div>
                    <Badge variant={connection.status === 'connected' ? 'default' : 'secondary'}>{connection.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
                  <p>Credentials configured · {connection.is_primary ? 'Primary connection' : 'Not primary'}</p>
                  {connection.last_error ? <Alert variant="destructive"><AlertTitle>Last test failed</AlertTitle><AlertDescription>{connection.last_error}</AlertDescription></Alert> : null}
                  {tab === 'email' ? <div className="flex max-w-sm flex-col gap-2"><Label htmlFor={`recipient-${connection.id}`}>Optional test recipient</Label><Input id={`recipient-${connection.id}`} type="email" value={form.recipient} onChange={(event) => update('recipient', event.target.value)} placeholder="you@example.com" /></div> : null}
                </CardContent>
                <CardFooter className="flex flex-wrap items-center justify-between gap-3">
                  <Button variant="outline" onClick={() => test(connection)} disabled={busy !== null}>{busy === `test-${connection.id}` ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <CheckCircle2 data-icon="inline-start" />}Test connection</Button>
                  <div className="flex items-center gap-2"><Label htmlFor={`enabled-${connection.id}`}>Enabled</Label><Switch id={`enabled-${connection.id}`} checked={connection.is_enabled} onCheckedChange={(checked) => toggle(connection, checked)} disabled={busy !== null} /></div>
                </CardFooter>
              </Card>
            ))}
            <Card>
              <CardHeader><CardTitle>Add {tab === 'email' ? 'email' : tab === 'sms' ? 'SMS' : 'WhatsApp'} provider</CardTitle><CardDescription>Save credentials first. The provider stays disabled until its connection test succeeds.{tab === 'sms' ? ' SMS is billed per segment by your provider — check regional pricing (e.g. Twilio rates in India) before large sends.' : ''}</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-col gap-2"><Label htmlFor={`${tab}-provider`}>Provider</Label><Select value={provider} onValueChange={(value) => setProvider(value as ChannelProvider)}><SelectTrigger id={`${tab}-provider`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{providers.map((item) => <SelectItem key={item.provider} value={item.provider}>{item.label}{item.available ? '' : ' — coming later'}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
                {!providers.find((item) => item.provider === provider)?.available ? <Alert><AlertTitle>Not available in this slice</AlertTitle><AlertDescription>This provider remains selectable in the architecture, but setup is disabled until its real authentication flow is implemented and tested.</AlertDescription></Alert> : (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-2"><Label htmlFor="connection-name">Connection name</Label><Input id="connection-name" value={form.displayName} onChange={(event) => update('displayName', event.target.value)} placeholder="Support inbox" /></div>
                      <div className="flex flex-col gap-2"><Label htmlFor="sender-identity">{tab === 'email' ? 'Sender email' : tab === 'sms' ? 'SMS number' : 'WhatsApp number'}</Label><Input id="sender-identity" type={tab === 'email' ? 'email' : 'tel'} value={form.externalIdentity} onChange={(event) => update('externalIdentity', event.target.value)} placeholder={tab === 'email' ? 'support@example.com' : '+15551234567'} /></div>
                    </div>
                    {provider === 'smtp' ? <div className="grid gap-4 md:grid-cols-2"><div className="flex flex-col gap-2"><Label htmlFor="smtp-host">SMTP host</Label><Input id="smtp-host" value={form.host} onChange={(event) => update('host', event.target.value)} placeholder="smtp.example.com" /></div><div className="flex flex-col gap-2"><Label htmlFor="smtp-port">Port</Label><Input id="smtp-port" inputMode="numeric" value={form.port} onChange={(event) => update('port', event.target.value)} /></div><div className="flex flex-col gap-2"><Label htmlFor="smtp-user">Username</Label><Input id="smtp-user" autoComplete="username" value={form.username} onChange={(event) => update('username', event.target.value)} /></div><div className="flex flex-col gap-2"><Label htmlFor="smtp-pass">Password</Label><Input id="smtp-pass" type="password" autoComplete="new-password" value={form.password} onChange={(event) => update('password', event.target.value)} /></div></div> : null}
                    {provider === 'resend' ? <div className="flex flex-col gap-2"><Label htmlFor="resend-key">API key</Label><Input id="resend-key" type="password" value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} /></div> : null}
                    {provider === 'twilio' && reusableTwilio ? (
                      <div className="flex items-start gap-3 rounded-md border p-4">
                        <Switch id="twilio-reuse" checked={reuseFromId !== null} onCheckedChange={(checked) => setReuseFromId(checked ? reusableTwilio.id : null)} />
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="twilio-reuse">Reuse credentials from &ldquo;{reusableTwilio.display_name}&rdquo; ({reusableTwilio.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'})</Label>
                          <p className="text-xs text-muted-foreground">Same Twilio account, no retyping — the stored Account SID, Auth token, and Messaging Service SID are copied server-side. Secrets never reach this browser.</p>
                        </div>
                      </div>
                    ) : null}
                    {provider === 'twilio' && !reuseFromId ? <div className="grid gap-4 md:grid-cols-2"><div className="flex flex-col gap-2"><Label htmlFor="twilio-sid">Account SID</Label><Input id="twilio-sid" value={form.accountSid} onChange={(event) => update('accountSid', event.target.value)} /></div><div className="flex flex-col gap-2"><Label htmlFor="twilio-token">Auth token</Label><Input id="twilio-token" type="password" value={form.authToken} onChange={(event) => update('authToken', event.target.value)} /></div>{tab !== 'email' ? <div className="flex flex-col gap-2 md:col-span-2"><Label htmlFor="twilio-messaging-service">Messaging Service SID <span className="font-normal text-muted-foreground">(optional, recommended)</span></Label><Input id="twilio-messaging-service" value={form.messagingServiceSid} onChange={(event) => update('messagingServiceSid', event.target.value)} placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /><p className="text-xs text-muted-foreground">{tab === 'sms' ? 'When set, sends use Twilio\u2019s Messaging Service for sender pooling, Sticky Sender, and carrier-managed STOP handling (Advanced Opt-Out). Leave blank to send from the number above.' : 'When set, sends route through the Messaging Service\u2019s sender pool — add your WhatsApp sender to the pool in the Twilio Console. Leave blank to send from the number above.'}</p></div> : null}</div> : null}
                  </>
                )}
              </CardContent>
              <CardFooter><Button onClick={save} disabled={busy !== null || !providers.find((item) => item.provider === provider)?.available}>{busy === 'save' ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}Save securely</Button></CardFooter>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}
