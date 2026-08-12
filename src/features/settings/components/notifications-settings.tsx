'use client';

// ============================================================
// NotificationsSettings — Settings → Notifications
//
// Row one is personal (chat popups, per-user). The rest is workspace
// alert delivery, admin-gated. Copy is deliberately terse: hints state
// a consequence ("Unread counts keep working either way") rather than
// re-explaining the control, which the label already does.
//
// Delivery today is a single tier:
//   Team chat — built-in, always available, cannot be deleted. The
//               floor that guarantees a waiting customer is never
//               silently dropped.
//
// External connectors are intentionally absent. The dispatcher parks
// (never dead-letters) rows whose provider has no adapter, so a future
// connector can be added here without a data migration.
//
// Any member can view; mutations are admin-gated here and again
// server-side (requireRole + RLS).
// ============================================================

import { useCallback } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { RequireRole } from '@/features/auth/components/require-role';
import type { AlertProvider } from '@/features/alerts/lib/types';
import { useChatNotificationPrefs } from '@/features/team-chat/hooks/use-chat-notification-prefs';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsGroup, SettingsRow } from './settings-row';

interface Destination {
  id: string;
  provider: AlertProvider;
  display_name: string;
  config: Record<string, unknown>;
  event_types: string[];
  enabled: boolean;
}

interface DestinationsPayload {
  destinations: Destination[];
}

async function fetchDestinations(url: string): Promise<DestinationsPayload> {
  const res = await fetch(url);
  const body = (await res.json()) as Partial<DestinationsPayload> & {
    error?: string;
  };
  if (!res.ok) throw new Error(body.error || 'Failed to load destinations');
  return { destinations: body.destinations ?? [] };
}

export function NotificationsSettings() {
  const { popupsEnabled, setPopupsEnabled } = useChatNotificationPrefs();

  const { data, isLoading, mutate } = useSWR(
    '/api/alerts/destinations',
    fetchDestinations,
    {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Network error'),
    }
  );

  const destinations = data?.destinations;

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

  const teamChat =
    destinations?.find((d) => d.provider === 'team_chat') ?? null;

  return (
    <div className="flex flex-col gap-6">
      <SettingsPanelHead
        title="Notifications"
        description="Where alerts go when nobody picks up."
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
          {/* Personal, not workspace-wide — and the only row here that
              every member can change for themselves. Listed first
              because it is the one people actually come looking for. */}
          <SettingsRow
            label="Chat popups"
            htmlFor="chat-popups"
            hint="Unread counts keep working either way."
          >
            <div className="flex items-center gap-3">
              <Switch
                id="chat-popups"
                checked={popupsEnabled}
                onCheckedChange={(checked) => void setPopupsEnabled(checked)}
              />
              <span className="text-muted-foreground text-sm">
                {popupsEnabled ? 'On' : 'Off'}
              </span>
            </div>
          </SettingsRow>

          <SettingsRow label="Team chat" hint="Posts to #Alerts.">
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
                <Badge variant="secondary">On first alert</Badge>
              )}
            </div>
          </SettingsRow>
        </SettingsGroup>
      )}
    </div>
  );
}
