'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Laptop, Loader2, MonitorSmartphone, Smartphone } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';

interface DeviceRow {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
}

/** Tiny UA parser — enough for a device list without a dependency. */
function describeAgent(ua: string | null): {
  label: string;
  mobile: boolean;
} {
  if (!ua) return { label: 'Unknown device', mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua) && /Version\//.test(ua)
          ? 'Safari'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return { label: `${browser} on ${os}`, mobile };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load devices');
  const body = (await res.json()) as { data: DeviceRow[] };
  return body.data;
};

export function DevicesCard() {
  const t = useTranslations('Settings.security');
  const [touched, setTouched] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Register the current session once, then load the list.
  useEffect(() => {
    fetch('/api/v1/security/devices', { method: 'POST' })
      .catch(() => null)
      .finally(() => setTouched(true));
  }, []);

  const { data, isLoading, mutate } = useSWR(
    touched ? '/api/v1/security/devices' : null,
    fetcher
  );

  const onRevoke = async (device: DeviceRow) => {
    setRevoking(device.id);
    try {
      const res = await fetch('/api/v1/security/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(body?.error ?? t('deviceRevokeFailed'));
        return;
      }
      toast.success(t('deviceRevoked'));
      if (device.is_current) {
        // Revoked own session — refresh token is dead; go to login.
        window.location.href = '/login';
        return;
      }
      await mutate();
    } catch {
      toast.error(t('deviceRevokeFailed'));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <MonitorSmartphone className="text-primary size-4" />
          {t('devicesTitle')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('devicesDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t('devicesLoading')}
          </div>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            {t('devicesEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.map((device) => {
              const agent = describeAgent(device.user_agent);
              const Icon = agent.mobile ? Smartphone : Laptop;
              return (
                <li
                  key={device.id}
                  className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <Icon
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-foreground truncate text-sm font-medium">
                        {agent.label}
                      </p>
                      {device.is_current && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t('deviceCurrent')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {device.ip_address ?? '—'} ·{' '}
                      {t('deviceLastActive', {
                        time: relativeTime(device.last_seen_at),
                      })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevoke(device)}
                    disabled={revoking !== null}
                    className="text-destructive hover:text-destructive shrink-0"
                  >
                    {revoking === device.id ? (
                      <Loader2
                        className="size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      t('deviceRevoke')
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
