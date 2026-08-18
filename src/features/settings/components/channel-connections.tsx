'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ChevronRight,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { BrandIcon } from '@/components/shared/brand-icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChannelConnectionSheet } from './channel-connection-sheet';
import {
  ChannelSetupSheet,
  type ChannelSetupInit,
} from './channel-setup-sheet';
import { ConnectChannelDialog } from './connect-channel-dialog';
import { SettingsPanelHead } from './settings-panel-head';
import type { ChannelConnection, ChannelKind, ChannelProvider } from '@/types';

type ProviderInfo = {
  provider: ChannelProvider;
  channel: ChannelKind;
  label: string;
  available: boolean;
};

/**
 * Brand mark for a provider card. Providers without a bundled brand SVG
 * fall back to a channel-appropriate lucide icon, so a newly registered
 * provider renders correctly before its logo is added.
 */
const PROVIDER_ICON_SRC: Partial<Record<ChannelProvider, string>> = {
  twilio: '/icons/brands/twilio.svg',
  meta: '/icons/brands/whatsapp.svg',
};

function providerCardIcon(provider: ChannelProvider) {
  const iconSrc = PROVIDER_ICON_SRC[provider];
  return iconSrc ? { iconSrc } : { icon: Mail };
}

/**
 * Short "what is this" line under a provider card. Falls back to a
 * generic per-channel phrase so an unrecognised provider still reads
 * sensibly instead of rendering an empty hint.
 */
function providerHint(provider: ChannelProvider, channel: ChannelKind): string {
  if (provider === 'smtp') return 'Any SMTP mailbox';
  if (provider === 'mailtrap') return 'Email API with sandbox testing';
  if (provider === 'meta') return 'Direct Meta (Facebook) connection';
  if (channel === 'email') return 'Transactional email API';
  if (channel === 'whatsapp') return 'WhatsApp Business messaging';
  return 'SMS messaging';
}
type Connection = ChannelConnection & {
  credentialsConfigured: boolean;
  providerLabel: string;
};
type GuidedConnect = {
  twilio: { configured: boolean; authorizeUrl: string | null };
  whatsappEmbeddedSignup: { configured: boolean };
};
type ResponseData = {
  connections: Connection[];
  providers: ProviderInfo[];
  guidedConnect?: GuidedConnect;
};

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error ?? 'Could not load channel connections');
  return payload;
};

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
  {
    title: string;
    heroTitle: string;
    description: string;
    requirements: string[];
  }
> = {
  whatsapp: {
    title: 'WhatsApp',
    heroTitle: 'Connect your WhatsApp Business account',
    description:
      'Link your WhatsApp Business number to engage customers in conversations, broadcasts, and automations. Manage message templates in the Template studio.',
    requirements: [
      'Connect via Meta (Facebook) with a WhatsApp Cloud API access token, or via Twilio with a WhatsApp-enabled number.',
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
};

const CHANNEL_ICON: Record<ChannelKind, typeof Mail> = {
  whatsapp: MessageCircle,
  sms: Smartphone,
  email: Mail,
};

/**
 * Bigin-style provider card ("Popular Email Services" pattern): a
 * bordered card with the brand mark and name. Brand SVGs are served
 * from /public (sourced from theSVG.org — review trademark policies).
 */
function ProviderCard({
  label,
  hint,
  iconSrc,
  icon: IconCmp,
  onClick,
}: {
  label: string;
  hint?: string;
  iconSrc?: string;
  icon?: typeof Mail;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border bg-card hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-ring flex w-40 flex-col items-center gap-3 rounded-lg border px-4 py-6 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {iconSrc ? (
        <BrandIcon src={iconSrc} size={40} />
      ) : IconCmp ? (
        <IconCmp
          className="text-muted-foreground size-10"
          strokeWidth={1.25}
          aria-hidden
        />
      ) : null}
      <span className="flex flex-col gap-0.5">
        <span className="text-foreground text-sm font-medium">{label}</span>
        {hint ? (
          <span className="text-muted-foreground text-xs leading-snug">
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ChannelConnections({
  fixedChannel,
}: {
  fixedChannel?: ChannelKind;
}) {
  const { data, error, isLoading, mutate } = useSWR<ResponseData>(
    '/api/settings/channels',
    fetcher
  );
  // `fixedChannel` is the URL-driven section (Settings → WhatsApp / SMS /
  // Email). It must WIN over local state: the settings panel renders the
  // same component in the same slot for every channel, so React reuses
  // this instance when the section changes. Seeding state from the prop
  // (`useState(fixedChannel ?? 'email')`) pinned the view to whichever
  // channel was mounted first — switching WhatsApp → SMS changed the rail
  // and the prop but kept rendering WhatsApp until a hard refresh. Local
  // state now only backs the tabbed, unfixed variant.
  const [pickedChannel, setPickedChannel] = useState<ChannelKind>('email');
  const channel = fixedChannel ?? pickedChannel;
  const [connectOpen, setConnectOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInit, setSetupInit] = useState<ChannelSetupInit | null>(null);
  const [detailsConnection, setDetailsConnection] = useState<Connection | null>(
    null
  );
  const [busyToggle, setBusyToggle] = useState<string | null>(null);
  /** "Twilio already connected — reuse credentials?" prompt. */
  const [reusePromptOpen, setReusePromptOpen] = useState(false);
  /**
   * A setup sheet waiting for the overlay in front of it to finish
   * closing. The reuse prompt and the guided-connect dialog both hand
   * off to the setup sheet, and opening it straight from their button
   * handlers put two modals in the DOM at once: Base UI holds
   * `pointer-events: none` on <body> while a modal is mounted and only
   * releases it when the closing overlay finishes its exit transition,
   * so the sheet landed on a body that never regained pointer events and
   * nothing inside it — starting with Provider — could be clicked.
   * Queue the init here and open on `onOpenChangeComplete` instead.
   * Wrapped in an object because `null` is itself a valid init (the
   * "Custom" card passes it to mean "no provider preselected").
   */
  const [pendingSetup, setPendingSetup] = useState<{
    init: ChannelSetupInit | null;
  } | null>(null);

  const connections = useMemo(
    () => data?.connections.filter((item) => item.channel === channel) ?? [],
    [data, channel]
  );
  const providers = useMemo(
    () =>
      (data?.providers.filter((item) => item.channel === channel) ?? []).map(
        ({ provider, label, available }) => ({ provider, label, available })
      ),
    [data, channel]
  );
  // An existing Twilio connection on ANOTHER channel whose credentials
  // can be reused — one Twilio account often serves WhatsApp + SMS, so
  // we offer reuse instead of duplicating secrets.
  const reusableTwilio = useMemo(
    () =>
      data?.connections.find(
        (item) => item.provider === 'twilio' && item.channel !== channel
      ) ?? null,
    [data, channel]
  );

  async function quickToggle(connection: Connection, enabled: boolean) {
    // Support can lock the toggle (e.g. number under carrier review) —
    // surface their notice instead of a failed request.
    if (
      connection.managed_by === 'platform' &&
      connection.client_can_toggle === false
    ) {
      toast.error(
        connection.platform_notice?.trim() ||
          'This connection is temporarily locked by our support team. Contact support for details.'
      );
      return;
    }
    setBusyToggle(connection.id);
    try {
      const response = await fetch('/api/settings/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: connection.id,
          isEnabled: enabled,
          isPrimary: enabled ? true : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? 'Could not update connection');
      await mutate();
      toast.success(enabled ? 'Connection enabled.' : 'Connection disabled.');
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not update connection'
      );
    } finally {
      setBusyToggle(null);
    }
  }

  function openSetup(init: ChannelSetupInit | null) {
    setSetupInit(init);
    setSetupOpen(true);
  }

  /**
   * Opens the setup sheet only once the overlay that queued it has
   * finished closing — wired to each hand-off overlay's
   * `onOpenChangeComplete`. See `pendingSetup` for why the hand-off
   * cannot happen inside the button handler.
   */
  function flushPendingSetup(open: boolean) {
    if (open || !pendingSetup) return;
    const next = pendingSetup;
    setPendingSetup(null);
    openSetup(next.init);
  }

  /**
   * Twilio entry point with duplicate-credential handling: one Twilio
   * account usually serves both WhatsApp and SMS. If Twilio is already
   * connected on the sibling channel, ask "reuse those credentials?"
   * before opening the setup sheet, instead of silently duplicating
   * secrets.
   */
  function startTwilio() {
    if (reusableTwilio) setReusePromptOpen(true);
    else if (data?.guidedConnect?.twilio.configured) setConnectOpen(true);
    else openSetup({ provider: 'twilio' });
  }

  function startConnect(target: ChannelKind) {
    if (target === 'email') openSetup(null);
    else startTwilio();
  }

  const visibleChannels: ChannelKind[] = fixedChannel
    ? [fixedChannel]
    : ['email', 'whatsapp', 'sms'];

  return (
    <section>
      {/* The rail now has a row per channel, so when `fixedChannel` is set
          this panel is the whole page and still needs its own heading —
          without one the content started abruptly under the page title.
          The per-channel copy from CHANNEL_HEAD is more useful here than
          the generic "Channels" blurb, which only makes sense when the
          internal tab strip is visible. */}
      <SettingsPanelHead
        title={fixedChannel ? CHANNEL_HEAD[fixedChannel].title : 'Channels'}
        description={
          fixedChannel
            ? CHANNEL_HEAD[fixedChannel].description
            : 'Connect email, WhatsApp, and SMS providers without changing how conversations work. Each channel is independent — providers are configured, tested, and enabled per channel.'
        }
      />

      <Tabs
        value={channel}
        onValueChange={(value) => setPickedChannel(value as ChannelKind)}
      >
        {fixedChannel ? null : (
          <TabsList>
            <TabsTrigger value="email">
              <Mail />
              Email
            </TabsTrigger>
            <TabsTrigger value="whatsapp">
              <MessageCircle />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="sms">
              <Smartphone />
              SMS
            </TabsTrigger>
          </TabsList>
        )}
        {visibleChannels.map((tab) => {
          const head = CHANNEL_HEAD[tab];
          const Icon = CHANNEL_ICON[tab];
          const empty = !isLoading && connections.length === 0;
          return (
            <TabsContent
              key={tab}
              value={tab}
              className="flex flex-col gap-5 pt-2"
            >
              {isLoading ? (
                <Card>
                  <CardContent className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin" />
                    <span className="sr-only">Loading connections</span>
                  </CardContent>
                </Card>
              ) : null}
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Connections unavailable</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              ) : null}

              {empty ? (
                /* Bigin-style connect hero — shown until the first
                   connection exists. Providers are presented as brand
                   cards (like Bigin's "Popular Email Services"); only
                   paths that actually work are visible — guided
                   one-click options appear when their env config
                   exists. */
                <div className="flex flex-col items-center gap-4 pt-4 text-center">
                  <h2 className="text-foreground text-2xl font-bold text-balance">
                    {head.heroTitle}
                  </h2>
                  {tab === 'whatsapp' ? (
                    <BrandIcon
                      src="/icons/brands/whatsapp.svg"
                      alt="WhatsApp"
                      size={48}
                    />
                  ) : (
                    <div className="bg-primary-soft flex size-14 items-center justify-center rounded-full">
                      <Icon className="text-primary size-7" aria-hidden />
                    </div>
                  )}
                  <p className="text-muted-foreground max-w-xl text-sm leading-relaxed text-pretty">
                    {head.description}
                  </p>
                  <div className="flex w-full max-w-2xl flex-col gap-3 pt-2">
                    <h3 className="text-foreground text-left text-sm font-semibold">
                      {tab === 'email'
                        ? 'Popular email services:'
                        : `Popular ${tab === 'sms' ? 'SMS' : 'WhatsApp'} services:`}
                    </h3>
                    <div className="flex flex-wrap gap-4">
                      {/*
                        One card per provider the registry reports for
                        this channel. WhatsApp and SMS used to hardcode
                        their cards, so a newly registered provider
                        (MSG91/Gupshup for SMS) would have been invisible
                        here even once its adapter existed. Twilio keeps
                        its dedicated entry point because it has a guided
                        Connect flow and credential reuse; everything
                        else goes to the manual setup sheet.
                      */}
                      {providers
                        .filter((item) => item.available)
                        .map((item) => (
                          <ProviderCard
                            key={item.provider}
                            label={
                              item.provider === 'meta'
                                ? 'WhatsApp Cloud API'
                                : item.label
                            }
                            hint={providerHint(item.provider, tab)}
                            {...providerCardIcon(item.provider)}
                            onClick={() =>
                              item.provider === 'twilio'
                                ? startTwilio()
                                : openSetup({ provider: item.provider })
                            }
                          />
                        ))}
                      {providers.filter((item) => item.available).length > 1 ? (
                        /* A "Custom" card only makes sense when the
                           channel has more than one provider — with a
                           single one it opens the identical form. */
                        <ProviderCard
                          label="Custom"
                          hint="Other providers & manual setup"
                          icon={Settings2}
                          onClick={() => openSetup(null)}
                        />
                      ) : null}
                    </div>
                  </div>
                  <div className="w-full max-w-2xl rounded-lg bg-amber-500/10 px-5 py-4 text-left">
                    <h3 className="text-foreground mb-2 text-sm font-semibold">
                      Requirements
                    </h3>
                    <ul className="flex flex-col gap-1.5">
                      {head.requirements.map((requirement) => (
                        <li
                          key={requirement}
                          className="text-foreground/85 flex gap-2.5 text-sm leading-relaxed"
                        >
                          <span
                            aria-hidden
                            className="bg-foreground/60 mt-2 size-1 shrink-0 rounded-full"
                          />
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
                      <h2 className="text-foreground text-lg font-semibold">
                        {head.title} numbers
                      </h2>
                      <p className="text-muted-foreground text-sm">
                        {connections.length} connection
                        {connections.length === 1 ? '' : 's'} · click a row for
                        details, test, and controls
                      </p>
                    </div>
                    <Button onClick={() => startConnect(tab)}>
                      <Plus data-icon="inline-start" />
                      Add {tab === 'email' ? 'sender' : 'number'}
                    </Button>
                  </div>
                  <div className="divide-border border-border divide-y overflow-hidden rounded-lg border">
                    {connections.map((connection) => (
                      <div
                        key={connection.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDetailsConnection(connection)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setDetailsConnection(connection);
                          }
                        }}
                        className="bg-card hover:bg-muted/50 flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors"
                      >
                        <div className="bg-primary-soft flex size-9 shrink-0 items-center justify-center rounded-full">
                          <Icon className="text-primary size-4.5" aria-hidden />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-foreground truncate text-sm font-medium">
                            {connection.display_name}
                          </span>
                          <span className="text-muted-foreground truncate text-xs">
                            {connection.external_identity} ·{' '}
                            {connection.providerLabel}
                            {connection.is_primary ? ' · Primary' : ''}
                          </span>
                          {connection.platform_notice ? (
                            <span className="truncate text-xs text-amber-600 dark:text-amber-500">
                              {connection.platform_notice}
                            </span>
                          ) : null}
                        </div>
                        {connection.managed_by === 'platform' ? (
                          <Badge variant="outline" className="shrink-0 gap-1">
                            <ShieldCheck className="size-3" aria-hidden />
                            Managed
                          </Badge>
                        ) : null}
                        <Badge
                          variant={
                            connection.status === 'connected'
                              ? 'default'
                              : 'secondary'
                          }
                          className="shrink-0"
                        >
                          {connection.status}
                        </Badge>
                        <span
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <Switch
                            checked={connection.is_enabled}
                            onCheckedChange={(checked) =>
                              quickToggle(connection, checked)
                            }
                            disabled={busyToggle !== null}
                            aria-label={`${connection.display_name} enabled`}
                          />
                        </span>
                        <ChevronRight
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </TabsContent>
          );
        })}
      </Tabs>

      {channel !== 'email' && data?.guidedConnect?.twilio.configured ? (
        <ConnectChannelDialog
          channel={channel}
          open={connectOpen}
          onOpenChange={setConnectOpen}
          authorizeUrl={data?.guidedConnect?.twilio.authorizeUrl ?? null}
          reusable={
            reusableTwilio
              ? {
                  id: reusableTwilio.id,
                  displayName: reusableTwilio.display_name,
                  channelLabel:
                    reusableTwilio.channel === 'whatsapp'
                      ? 'WhatsApp'
                      : reusableTwilio.channel === 'sms'
                        ? 'SMS'
                        : 'Email',
                }
              : null
          }
          onOpenChangeComplete={flushPendingSetup}
          onContinue={({ accountSid, reuseFromId }) => {
            setPendingSetup({
              init: {
                ...(accountSid ? { accountSid } : {}),
                ...(reuseFromId && reusableTwilio
                  ? { reuseFromId, reuseFromLabel: reusableTwilio.display_name }
                  : {}),
              },
            });
          }}
        />
      ) : null}

      {/* Concise enterprise-style prompt (Slack/Stripe pattern): brand
          mark + one short sentence + two clear actions. Details about
          billing/credentials live in the setup sheet, not here. */}
      <AlertDialog
        open={reusePromptOpen}
        onOpenChange={setReusePromptOpen}
        onOpenChangeComplete={flushPendingSetup}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="border-border bg-card mb-1 flex size-10 items-center justify-center rounded-lg border">
              <BrandIcon src="/icons/brands/twilio.svg" size={24} />
            </div>
            <AlertDialogTitle>
              Use your existing Twilio account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reusableTwilio
                ? `“${reusableTwilio.display_name}” is already connected for ${reusableTwilio.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setPendingSetup({ init: { provider: 'twilio' } })}
            >
              Connect new account
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!reusableTwilio) return;
                setPendingSetup({
                  init: {
                    provider: 'twilio',
                    reuseFromId: reusableTwilio.id,
                    reuseFromLabel: reusableTwilio.display_name,
                  },
                });
                // AlertDialogAction renders a plain Button, not a
                // Close part, so it does not dismiss the prompt on its
                // own — without this the prompt stayed mounted and kept
                // trapping pointer events over the setup sheet.
                setReusePromptOpen(false);
              }}
            >
              Use existing account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChannelSetupSheet
        channel={channel}
        open={setupOpen}
        init={setupInit}
        providers={providers}
        onOpenChange={setSetupOpen}
        onSaved={() => {
          void mutate();
        }}
      />

      <ChannelConnectionSheet
        connection={
          detailsConnection
            ? (connections.find((item) => item.id === detailsConnection.id) ??
              detailsConnection)
            : null
        }
        channel={channel}
        open={detailsConnection !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsConnection(null);
        }}
        onChanged={() => mutate()}
        onEdit={(target) => {
          // Edit in place: prefill from the row; stored credentials are
          // kept server-side unless new ones are typed in the sheet.
          setSetupInit({
            provider: target.provider as ChannelSetupInit['provider'],
            editId: target.id,
            displayName: target.display_name,
            externalIdentity: target.external_identity,
            messagingServiceSid:
              typeof (
                target.configuration as { messaging_service_sid?: string }
              )?.messaging_service_sid === 'string'
                ? ((
                    target.configuration as { messaging_service_sid?: string }
                  ).messaging_service_sid ?? '')
                : '',
          });
          setSetupOpen(true);
        }}
      />
    </section>
  );
}
