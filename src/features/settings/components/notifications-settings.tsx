'use client';

// ============================================================
// NotificationsSettings — Settings → Notifications
//
// Two delivery tiers:
//   Team chat  — built-in, always available, cannot be deleted. The
//                floor that guarantees a waiting customer is never
//                silently dropped.
//   Slack      — optional connector. OAuth, so the client never
//                handles a token. Hidden entirely when this
//                deployment has no Slack app configured, rather than
//                showing a button that could only fail.
//
// Any member can view; mutations are admin-gated here and again
// server-side (requireRole + RLS).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';
import { Hash, Loader2, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { RequireRole } from '@/features/auth/components/require-role';
import type { AlertProvider } from '@/features/alerts/lib/types';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsGroup, SettingsRow } from './settings-row';

interface Destination {
  id: string;
  provider: AlertProvider;
  display_name: string;
  config: { team_name?: string; channel_id?: string; channel_name?: string };
  event_types: string[];
  enabled: boolean;
}

interface DestinationsPayload {
  destinations: Destination[];
  available: { slack: boolean };
}

async function fetchDestinations(url: string): Promise<DestinationsPayload> {
  const res = await fetch(url);
  const body = (await res.json()) as Partial<DestinationsPayload> & {
    error?: string;
  };
  if (!res.ok) throw new Error(body.error || 'Failed to load destinations');
  return {
    destinations: body.destinations ?? [],
    available: body.available ?? { slack: false },
  };
}

export function NotificationsSettings() {
  const { data, isLoading, mutate } = useSWR(
    '/api/alerts/destinations',
    fetchDestinations,
    {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Network error'),
    }
  );

  const destinations = data?.destinations;
  const slackAvailable = data?.available.slack ?? false;

  // ---- Slack connect popup ------------------------------------------
  const popupRef = useRef<Window | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const payload = event.data as { source?: string; ok?: boolean };
      if (payload?.source !== 'slack-connect') return;
      setConnecting(false);
      if (payload.ok) {
        toast.success('Slack connected');
        void mutate();
      } else {
        toast.error('Slack connection failed');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mutate]);

  const connectSlack = useCallback(() => {
    setConnecting(true);
    // Named window: a double-click focuses the existing popup rather than
    // racing two OAuth flows against each other.
    popupRef.current = window.open(
      '/api/alerts/connectors/slack/install',
      'slack-connect',
      'width=620,height=760'
    );
    if (!popupRef.current) {
      setConnecting(false);
      toast.error('Popup blocked — allow popups and retry');
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
      // Optimistic: flip locally, roll back by revalidating on failure.
      void mutate(
        (prev) =>
          prev && {
            ...prev,
            destinations: prev.destinations.map((d) =>
              d.id === dest.id ? { ...d, enabled } : d
            ),
          },
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
      toast.success(`Removed ${dest.display_name}`);
      void mutate();
    },
    [mutate]
  );

  const teamChat =
    destinations?.find((d) => d.provider === 'team_chat') ?? null;
  const slackDests = (destinations ?? []).filter((d) => d.provider === 'slack');

  return (
    <div className="flex flex-col gap-6">
      <SettingsPanelHead
        title="Notifications"
        description="Where alerts go when a customer is waiting and nobody has picked up."
      />

      {isLoading ? (
        <SettingsGroup>
          <SettingsRow label={<Skeleton className="h-5 w-24" />}>
            <Skeleton className="h-9 w-full max-w-sm" />
          </SettingsRow>
          <SettingsRow label={<Skeleton className="h-5 w-16" />}>
            <Skeleton className="h-9 w-full max-w-sm" />
          </SettingsRow>
        </SettingsGroup>
      ) : (
        <SettingsGroup>
          <SettingsRow
            label="Team chat"
            hint="Posts to the #Alerts channel in this workspace. Available without setup."
          >
            <div className="flex items-center gap-3">
              {teamChat ? (
                <RequireRole
                  min="admin"
                  fallback={
                    <Badge variant={teamChat.enabled ? 'secondary' : 'outline'}>
                      {teamChat.enabled ? 'On' : 'Paused'}
                    </Badge>
                  }
                >
                  <Switch
                    id="team-chat-alerts"
                    checked={teamChat.enabled}
                    onCheckedChange={(checked) => toggle(teamChat, checked)}
                    aria-label="Team chat alerts"
                  />
                  <span className="text-muted-foreground text-sm">
                    {teamChat.enabled ? 'On' : 'Paused'}
                  </span>
                </RequireRole>
              ) : (
                <Badge variant="secondary">
                  Activates with the first alert
                </Badge>
              )}
            </div>
          </SettingsRow>

          {slackAvailable ? (
            <SettingsRow
              label="Slack"
              hint="Sign in to your workspace and choose one channel. The bot posts nowhere else."
            >
              {slackDests.length === 0 ? (
                <RequireRole
                  min="admin"
                  fallback={
                    <span className="text-muted-foreground text-sm">
                      Not connected
                    </span>
                  }
                >
                  <Button
                    variant="outline"
                    onClick={connectSlack}
                    disabled={connecting}
                    className="w-fit"
                  >
                    {connecting ? (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <Hash data-icon="inline-start" />
                    )}
                    Connect Slack
                  </Button>
                </RequireRole>
              ) : (
                <div className="flex flex-col gap-4">
                  {slackDests.map((dest) => (
                    <SlackConnection
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
                          toast.success(`Posting to #${channelName}`);
                          void mutate();
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : 'Update failed'
                          );
                        }
                      }}
                    />
                  ))}
                  <RequireRole min="admin">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={connectSlack}
                      disabled={connecting}
                      className="w-fit"
                    >
                      Add another workspace
                    </Button>
                  </RequireRole>
                </div>
              )}
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      )}
    </div>
  );
}

function SlackConnection({
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
  const needsChannel = !destination.config.channel_id;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-foreground text-sm">
          {destination.config.team_name || destination.display_name}
        </span>
        {needsChannel ? (
          <Badge variant="destructive">Choose a channel</Badge>
        ) : null}
        <RequireRole
          min="admin"
          fallback={
            <Badge variant={destination.enabled ? 'secondary' : 'outline'}>
              {destination.enabled ? 'On' : 'Paused'}
            </Badge>
          }
        >
          <Switch
            checked={destination.enabled}
            onCheckedChange={(checked) => onToggle(destination, checked)}
            aria-label={`${destination.display_name} alerts`}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemove(destination)}
            aria-label={`Disconnect ${destination.display_name}`}
          >
            <Trash2 />
          </Button>
        </RequireRole>
      </div>

      <RequireRole min="admin">
        <ChannelPicker
          destinationId={destination.id}
          currentChannelId={destination.config.channel_id}
          onPick={onPickChannel}
        />
      </RequireRole>
    </div>
  );
}

function ChannelPicker({
  destinationId,
  currentChannelId,
  onPick,
}: {
  destinationId: string;
  currentChannelId?: string;
  onPick: (channelId: string, channelName: string) => Promise<void>;
}) {
  // Lazy: channels are fetched only once the picker opens, so loading
  // Settings never costs a Slack API round-trip.
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
    <Select
      value={currentChannelId}
      onOpenChange={setOpen}
      onValueChange={(channelId) => {
        const channel = data?.find((c) => c.id === channelId);
        if (channel) void onPick(channel.id, channel.name);
      }}
    >
      <SelectTrigger className="w-full max-w-xs" aria-label="Alert channel">
        <SelectValue placeholder="Choose a channel" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading
            </div>
          ) : (
            (data ?? []).map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                #{channel.name}
              </SelectItem>
            ))
          )}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
