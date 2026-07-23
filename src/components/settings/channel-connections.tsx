'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { ChevronRight, Loader2, Mail, MessageCircle, Plus, ShieldCheck, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChannelConnectionSheet } from './channel-connection-sheet'
import { ChannelSetupSheet, type ChannelSetupInit } from './channel-setup-sheet'
import { ConnectChannelDialog } from './connect-channel-dialog'
import { SettingsPanelHead } from './settings-panel-head'
import type { ChannelConnection, ChannelKind, ChannelProvider } from '@/types'

type ProviderInfo = { provider: ChannelProvider; channel: ChannelKind; label: string; available: boolean }
type Connection = ChannelConnection & { credentialsConfigured: boolean; providerLabel: string }
type GuidedConnect = {
  twilio: { configured: boolean; authorizeUrl: string | null }
  whatsappEmbeddedSignup: { configured: boolean }
}
type ResponseData = { connections: Connection[]; providers: ProviderInfo[]; guidedConnect?: GuidedConnect }

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error ?? 'Could not load channel connections')
  return payload
}

/**
 * Per-channel copy and requirements: WhatsApp is a policy-governed
 * channel (Meta template approval, 24h session window), SMS is
 * carrier-based pay-per-segment, Email is free-form. Rendered
 * Bigin-style: a centered connect hero plus an amber "Requirements"
 * callout — but only until the first connection exists. After that the
 * page becomes an enterprise numbers list with a details sheet.
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

const CHANNEL_ICON: Record<ChannelKind, typeof Mail> = { whatsapp: MessageCircle, sms: Smartphone, email: Mail }

export function ChannelConnections({ fixedChannel }: { fixedChannel?: ChannelKind }) {
  const { data, error, isLoading, mutate } = useSWR<ResponseData>('/api/settings/channels', fetcher)
  const [channel, setChannel] = useState<ChannelKind>(fixedChannel ?? 'email')
  const [connectOpen, setConnectOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupInit, setSetupInit] = useState<ChannelSetupInit | null>(null)
  const [detailsConnection, setDetailsConnection] = useState<Connection | null>(null)
  const [busyToggle, setBusyToggle] = useState<string | null>(null)

  const connections = useMemo(() => data?.connections.filter((item) => item.channel === channel) ?? [], [data, channel])
  const providers = useMemo(
    () => (data?.providers.filter((item) => item.channel === channel) ?? []).map(({ provider, label, available }) => ({ provider, label, available })),
    [data, channel],
  )
  // An existing Twilio connection on ANOTHER channel whose credentials
  // can be reused — one Twilio account often serves WhatsApp + SMS, so
  // we offer reuse instead of duplicating secrets.
  const reusableTwilio = useMemo(
    () => data?.connections.find((item) => item.provider === 'twilio' && item.channel !== channel) ?? null,
    [data, channel],
  )

  async function quickToggle(connection: Connection, enabled: boolean) {
    setBusyToggle(connection.id)
    try {
      const response = await fetch('/api/settings/channels', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: connection.id, isEnabled: enabled, isPrimary: enabled ? true : undefined }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Could not update connection')
      await mutate()
      toast.success(enabled ? 'Connection enabled.' : 'Connection disabled.')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not update connection')
    } finally {
      setBusyToggle(null)
    }
  }

  function openSetup(init: ChannelSetupInit | null) {
    setSetupInit(init)
    setSetupOpen(true)
  }

  function startConnect(target: ChannelKind) {
    // Email has no OAuth-style popup — go straight to the setup sheet.
    if (target === 'email') openSetup(null)
    else setConnectOpen(true)
  }

  const visibleChannels: ChannelKind[] = fixedChannel ? [fixedChannel] : ['email', 'whatsapp', 'sms']

  return (
    <section>
      {!fixedChannel ? (
        <>
          <SettingsPanelHead title="Channels" description="Connect email, WhatsApp, and SMS providers without changing how conversations work. Each channel is independent — providers are configured, tested, and enabled per channel." />
          <Alert className="mb-5">
            <ShieldCheck />
            <AlertTitle>Provider-neutral and secret-safe</AlertTitle>
            <AlertDescription>Credentials are encrypted at rest and never returned to this browser. Switching providers requires deliberate setup and a successful health check.</AlertDescription>
          </Alert>
        </>
      ) : null}

      <Tabs value={channel} onValueChange={(value) => setChannel(value as ChannelKind)}>
        {fixedChannel ? null : (
          <TabsList>
            <TabsTrigger value="email"><Mail />Email</TabsTrigger>
            <TabsTrigger value="whatsapp"><MessageCircle />WhatsApp</TabsTrigger>
            <TabsTrigger value="sms"><Smartphone />SMS</TabsTrigger>
          </TabsList>
        )}
        {visibleChannels.map((tab) => {
          const head = CHANNEL_HEAD[tab]
          const Icon = CHANNEL_ICON[tab]
          const empty = !isLoading && connections.length === 0
          return (
            <TabsContent key={tab} value={tab} className="flex flex-col gap-5 pt-2">
              {isLoading ? (
                <Card><CardContent className="flex items-center justify-center py-12"><Loader2 className="animate-spin" /><span className="sr-only">Loading connections</span></CardContent></Card>
              ) : null}
              {error ? <Alert variant="destructive"><AlertTitle>Connections unavailable</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert> : null}

              {empty ? (
                /* Bigin-style connect hero — shown until the first
                   connection exists. */
                <div className="flex flex-col items-center gap-4 pt-4 text-center">
                  <h2 className="text-2xl font-bold text-balance text-foreground">{head.heroTitle}</h2>
                  <div className="flex size-14 items-center justify-center rounded-full bg-primary-soft">
                    <Icon className="size-7 text-primary" aria-hidden />
                  </div>
                  <p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground">{head.description}</p>
                  <Button size="lg" className="rounded-full px-8" onClick={() => startConnect(tab)}>
                    Connect now
                  </Button>
                  <div className="w-full max-w-2xl rounded-lg bg-amber-500/10 px-5 py-4 text-left">
                    <h3 className="mb-2 text-sm font-semibold text-foreground">Requirements</h3>
                    <ul className="flex flex-col gap-1.5">
                      {head.requirements.map((requirement) => (
                        <li key={requirement} className="flex gap-2.5 text-sm leading-relaxed text-foreground/85">
                          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/60" />
                          {requirement}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              {!empty && !isLoading ? (
                /* Enterprise numbers list: one compact row per
                   connection; click opens the details sheet. */
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-lg font-semibold text-foreground">{head.title} numbers</h2>
                      <p className="text-sm text-muted-foreground">{connections.length} connection{connections.length === 1 ? '' : 's'} · click a row for details, test, and controls</p>
                    </div>
                    <Button onClick={() => startConnect(tab)}>
                      <Plus data-icon="inline-start" />
                      Add {tab === 'email' ? 'sender' : 'number'}
                    </Button>
                  </div>
                  <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {connections.map((connection) => (
                      <div
                        key={connection.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDetailsConnection(connection)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailsConnection(connection) } }}
                        className="flex cursor-pointer items-center gap-4 bg-card px-4 py-3.5 transition-colors hover:bg-muted/50"
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft">
                          <Icon className="size-4.5 text-primary" aria-hidden />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">{connection.display_name}</span>
                          <span className="truncate text-xs text-muted-foreground">{connection.external_identity} · {connection.providerLabel}{connection.is_primary ? ' · Primary' : ''}</span>
                        </div>
                        <Badge variant={connection.status === 'connected' ? 'default' : 'secondary'} className="shrink-0">{connection.status}</Badge>
                        <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                          <Switch
                            checked={connection.is_enabled}
                            onCheckedChange={(checked) => quickToggle(connection, checked)}
                            disabled={busyToggle !== null}
                            aria-label={`${connection.display_name} enabled`}
                          />
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </TabsContent>
          )
        })}
      </Tabs>

      {channel !== 'email' ? (
        <ConnectChannelDialog
          channel={channel}
          open={connectOpen}
          onOpenChange={setConnectOpen}
          authorizeUrl={data?.guidedConnect?.twilio.authorizeUrl ?? null}
          reusable={reusableTwilio ? { id: reusableTwilio.id, displayName: reusableTwilio.display_name, channelLabel: reusableTwilio.channel === 'whatsapp' ? 'WhatsApp' : reusableTwilio.channel === 'sms' ? 'SMS' : 'Email' } : null}
          onContinue={({ accountSid, reuseFromId }) => {
            openSetup({
              ...(accountSid ? { accountSid } : {}),
              ...(reuseFromId && reusableTwilio ? { reuseFromId, reuseFromLabel: reusableTwilio.display_name } : {}),
            })
          }}
        />
      ) : null}

      <ChannelSetupSheet
        channel={channel}
        open={setupOpen}
        init={setupInit}
        providers={providers}
        onOpenChange={setSetupOpen}
        onSaved={() => { void mutate() }}
      />

      <ChannelConnectionSheet
        connection={detailsConnection ? (connections.find((item) => item.id === detailsConnection.id) ?? detailsConnection) : null}
        channel={channel}
        open={detailsConnection !== null}
        onOpenChange={(open) => { if (!open) setDetailsConnection(null) }}
        onChanged={() => mutate()}
      />
    </section>
  )
}
