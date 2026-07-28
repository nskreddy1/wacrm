'use client';

// ============================================================
// NotificationsSettings — Settings → Notifications
//
// Where a workspace controls HOW the team hears about handoff
// escalations (and, later, other alert types):
//
//   Tier 1 (built-in, zero setup): the app's own team chat.
//     Auto-provisioned on the first alert; can be paused but never
//     deleted — the delivery floor that guarantees an unattended
//     customer is never silently dropped.
//
//   Tier 2 (optional connectors): Slack today; WhatsApp / Telegram /
//     Email ship next. Each is a SEPARATE connector by design — the
//     client clicks Connect, signs into their own workspace in a
//     popup (OAuth), and never touches an API token.
//
// Any member can view; connect/pause/delete are admin-gated both
// here (<RequireRole>) and server-side (requireRole + RLS).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';
import {
  Bell,
  Hash,
  Loader2,
  MessagesSquare,
  Plug,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RequireRole } from '@/features/auth/components/require-role';
import type { AlertProvider } from '@/features/alerts/lib/types';
import { SettingsPanelHead } from './settings-panel-head';

interface Destination {
  id: string;
  provider: AlertProvider;
  display_name: string;
  config: { team_name?: string; channel_id?: string; channel_name?: string };
  event_types: string[];
  enabled: boolean;
}

async function fetchDestinations(url: string): Promise<Destination[]> {
  const res = await fetch(url);
  const body = (await res.json()) as {
    destinations?: Destination[];
    error?: string;
  };
  if (!res.ok) throw new Error(body.error || 'Failed to load destinations');
  return body.destinations ?? [];
}

const PROVIDER_META: Record<
  AlertProvider,
  { label: string; blurb: string; icon: typeof Bell }
> = {
  team_chat: {
    label: 'Team chat',
    blurb: 'Built-in. Posts into the #Alerts channel inside this app.',
    icon: MessagesSquare,
  },
  slack: {
    label: 'Slack',
    blurb: 'Posts into a channel of your connected Slack workspace.',
    icon: Hash,
  },
  whatsapp: {
    label: 'WhatsApp',
    blurb: 'Sends a template message to your ops number.',
    icon: Bell,
  },
  telegram: {
    label: 'Telegram',
    blurb: 'Posts into a Telegram group via bot.',
    icon: Bell,
  },
  email: {
    label: 'Email',
    blurb: 'Sends an email digest to your team inbox.',
    icon: Bell,
  },
};

export function NotificationsSettings() {
  const {
    data: destinations,
    isLoading,
    mutate,
  } = useSWR('/api/alerts/destinations', fetchDestinations, {
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Network error'),
  });

  // ---- Slack connect popup ------------------------------------------
  const popupRef = useRef<Window | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; ok?: boolean };
      if (data?.source !== 'slack-connect') return;
      setConnecting(false);
      if (data.ok) {
        toast.success('Slack workspace connected');
        void mutate();
      } else {
        toast.error('Slack connection failed — please try again');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mutate]);

  const connectSlack = useCallback(() => {
    setConnecting(true);
    // Named window: a double-click focuses the existing popup instead of
    // opening two OAuth flows that would race each other.
    popupRef.current = window.open(
      '/api/alerts/connectors/slack/install',
      'slack-connect',
      'width=620,height=760'
    );
    if (!popupRef.current) {
      setConnecting(false);
      toast.error('Popup blocked — please allow popups and retry');
    }
  }, []);

  // ---- Mutations ----------------------------------------------------
  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch('/api/alerts/destinations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error || 'Update failed');
      }
    },
    []
  );

  const toggle = useCallback(
    async (dest: Destination, enabled: boolean) => {
      // Optimistic: flip locally, roll back on failure.
      void mutate(
        (prev) => prev?.map((d) => (d.id === dest.id ? { ...d, enabled } : d)),
        { revalidate: false }
      );
      try {
        await patch(dest.id, { enabled });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
        void mutate();
      }
    },
    [mutate, patch]
  );

  const remove = useCallback(
    async (dest: Destination) => {
      const res = await fetch('/api/alerts/destinations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dest.id }),
      });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        toast.error(payload.error || 'Delete failed');
        return;
      }
      toast.success(`Removed "${dest.display_name}"`);
      void mutate();
    },
    [mutate]
  );

  const hasSlack = destinations?.some((d) => d.provider === 'slack') ?? false;

  return (
    <div>
      <SettingsPanelHead
        title="Notifications"
        description="How your team gets alerted when a customer is waiting for a human and nobody has picked up the conversation."
        action={
          <RequireRole min="admin">
            <Button onClick={connectSlack} disabled={connecting}>
              {connecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              {hasSlack ? 'Connect another Slack' : 'Connect Slack'}
            </Button>
          </RequireRole>
        }
      />

      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading destinations…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <TeamChatCard
            destination={
              destinations?.find((d) => d.provider === 'team_chat') ?? null
            }
            onToggle={toggle}
          />

          {(destinations ?? [])
            .filter((d) => d.provider !== 'team_chat')
            .map((dest) => (
              <ConnectorCard
                key={dest.id}
                destination={dest}
                onToggle={toggle}
                onRemove={remove}
                onPickChannel={async (channelId, channelName) => {
                  try {
                    await patch(dest.id, {
                      config: {
                        channel_id: channelId,
                        channel_name: channelName,
                      },
                    });
                    toast.success(`Alerts will post to #${channelName}`);
                    void mutate();
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : 'Update failed'
                    );
                  }
                }}
              />
            ))}

          <ComingSoonRow />
        </div>
      )}
    </div>
  );
}

// ---- Tier 1: built-in team chat --------------------------------------

function TeamChatCard({
  destination,
  onToggle,
}: {
  destination: Destination | null;
  onToggle: (dest: Destination, enabled: boolean) => void;
}) {
  const meta = PROVIDER_META.team_chat;
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-md">
          <meta.icon className="text-foreground size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground text-sm font-medium">
              {meta.label}
            </span>
            <Badge variant="secondary">Built-in</Badge>
            <Badge variant="outline">Always available</Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {destination
              ? meta.blurb
              : 'Activates automatically with the first alert — nothing to set up.'}
          </p>
        </div>
        {destination ? (
          <RequireRole
            min="admin"
            fallback={<StatusDot on={destination.enabled} />}
          >
            <Switch
              checked={destination.enabled}
              onCheckedChange={(checked) => onToggle(destination, checked)}
              aria-label="Toggle team chat alerts"
            />
          </RequireRole>
        ) : (
          <Badge variant="secondary">Auto</Badge>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Tier 2: external connectors --------------------------------------

function ConnectorCard({
  destination,
  onToggle,
  onRemove,
  onPickChannel,
}: {
  destination: Destination;
  onToggle: (dest: Destination, enabled: boolean) => void;
  onRemove: (dest: Destination) => void;
  onPickChannel: (channelId: string, channelName: string) => Promise<void>;
}) {
  const meta = PROVIDER_META[destination.provider] ?? PROVIDER_META.slack;
  const needsChannel =
    destination.provider === 'slack' && !destination.config.channel_id;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-center gap-4">
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-md">
            <meta.icon className="text-foreground size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground text-sm font-medium">
                {destination.display_name}
              </span>
              {destination.config.team_name ? (
                <Badge variant="outline">{destination.config.team_name}</Badge>
              ) : null}
              {needsChannel ? (
                <Badge variant="destructive">Pick a channel</Badge>
              ) : destination.config.channel_name ? (
                <Badge variant="secondary">
                  <Hash className="size-3" />
                  {destination.config.channel_name}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-sm">
              {meta.blurb}
            </p>
          </div>
          <RequireRole
            min="admin"
            fallback={<StatusDot on={destination.enabled} />}
          >
            <div className="flex items-center gap-2">
              <Switch
                checked={destination.enabled}
                onCheckedChange={(checked) => onToggle(destination, checked)}
                aria-label={`Toggle ${destination.display_name}`}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(destination)}
                aria-label={`Remove ${destination.display_name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </RequireRole>
        </div>

        {destination.provider === 'slack' ? (
          <RequireRole min="admin">
            <SlackChannelPicker
              destinationId={destination.id}
              currentChannelId={destination.config.channel_id}
              onPick={onPickChannel}
            />
          </RequireRole>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SlackChannelPicker({
  destinationId,
  currentChannelId,
  onPick,
}: {
  destinationId: string;
  currentChannelId?: string;
  onPick: (channelId: string, channelName: string) => Promise<void>;
}) {
  // Lazy fetch: channels load only when the picker is opened, so the
  // settings page itself never pays for a Slack API round-trip.
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useSWR(
    open
      ? `/api/alerts/connectors/slack/channels?destinationId=${destinationId}`
      : null,
    async (url: string) => {
      const res = await fetch(url);
      const body = (await res.json()) as {
        channels?: Array<{ id: string; name: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || 'Failed to load channels');
      return body.channels ?? [];
    },
    {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Network error'),
    }
  );

  return (
    <div className="flex items-center gap-2">
      <Select
        value={currentChannelId}
        onOpenChange={setOpen}
        onValueChange={(channelId) => {
          const channel = data?.find((c) => c.id === channelId);
          if (channel) void onPick(channel.id, channel.name);
        }}
      >
        <SelectTrigger className="w-64" aria-label="Alert channel">
          <SelectValue placeholder="Choose a channel for alerts…" />
        </SelectTrigger>
        <SelectContent>
          {isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading channels…
            </div>
          ) : (
            (data ?? []).map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                #{channel.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        The bot posts only to the channel you pick here.
      </p>
    </div>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block size-2 rounded-full ${on ? 'bg-primary' : 'bg-muted-foreground/40'}`}
      aria-label={on ? 'Enabled' : 'Paused'}
    />
  );
}

function ComingSoonRow() {
  return (
    <p className="text-muted-foreground px-1 pt-1 text-xs">
      WhatsApp, Telegram and Email destinations are next — each connects
      separately, the same one-click way.
    </p>
  );
}
