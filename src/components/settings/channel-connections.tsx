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

export function ChannelConnections() {
  const { data, error, isLoading, mutate } = useSWR<ResponseData>('/api/settings/channels', fetcher)
  const [channel, setChannel] = useState<ChannelKind>('email')
  const [provider, setProvider] = useState<ChannelProvider>('smtp')
  const [form, setForm] = useState(defaults)
  const [busy, setBusy] = useState<string | null>(null)
  const connections = useMemo(() => data?.connections.filter((item) => item.channel === channel) ?? [], [data, channel])
  const providers = data?.providers.filter((item) => item.channel === channel) ?? []

  function update(name: keyof typeof defaults, value: string) { setForm((current) => ({ ...current, [name]: value })) }

  async function request(body: unknown, method = 'POST') {
    const response = await fetch('/api/settings/channels', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error ?? 'Channel operation failed')
    await mutate()
    return payload
  }

  async function save() {
    setBusy('save')
    try {
      const configuration = provider === 'smtp' ? { host: form.host, port: Number(form.port), secure: Number(form.port) === 465, requireTls: Number(form.port) === 587 } : {}
      const credentials = provider === 'smtp' ? { username: form.username, password: form.password } : provider === 'resend' ? { apiKey: form.apiKey } : provider === 'twilio' ? { accountSid: form.accountSid, authToken: form.authToken } : undefined
      await request({ action: 'save', channel, provider, displayName: form.displayName, externalIdentity: form.externalIdentity, configuration, credentials })
      setForm(defaults)
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

  return (
    <section>
      <SettingsPanelHead title="Channels" description="Connect email, WhatsApp, and SMS providers without changing how conversations work. Each channel is independent — a school can run SMS-only broadcasts without ever connecting WhatsApp. Providers are configured, tested, and enabled per channel, so future providers slot in beside the existing ones." />
      <Alert className="mb-5">
        <ShieldCheck />
        <AlertTitle>Provider-neutral and secret-safe</AlertTitle>
        <AlertDescription>Credentials are encrypted at rest and never returned to this browser. Switching providers requires deliberate setup and a successful health check.</AlertDescription>
      </Alert>
      <Tabs value={channel} onValueChange={(value) => { const next = value as ChannelKind; setChannel(next); setProvider(next === 'email' ? 'smtp' : 'twilio') }}>
        <TabsList>
          <TabsTrigger value="email"><Mail />Email</TabsTrigger>
          <TabsTrigger value="whatsapp"><MessageCircle />WhatsApp</TabsTrigger>
          <TabsTrigger value="sms"><Smartphone />SMS</TabsTrigger>
        </TabsList>
        {(['email', 'whatsapp', 'sms'] as const).map((tab) => (
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
                    {provider === 'twilio' ? <div className="grid gap-4 md:grid-cols-2"><div className="flex flex-col gap-2"><Label htmlFor="twilio-sid">Account SID</Label><Input id="twilio-sid" value={form.accountSid} onChange={(event) => update('accountSid', event.target.value)} /></div><div className="flex flex-col gap-2"><Label htmlFor="twilio-token">Auth token</Label><Input id="twilio-token" type="password" value={form.authToken} onChange={(event) => update('authToken', event.target.value)} /></div></div> : null}
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
