'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  Laptop,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Smartphone,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

interface DeviceRow {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  location: string;
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

/**
 * Devices & sessions: the full session surface in one place — every
 * logged-in device with per-device revoke, and the global
 * "sign out everywhere" escape hatch as the card's footer.
 */
export function DevicesCard() {
  const t = useTranslations('Settings.security');
  const tp = useTranslations('Settings.profile');
  const [touched, setTouched] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

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
        // `assign` rather than writing `location.href`: same navigation,
        // but a method call instead of a mutation of a global the React
        // compiler (rightly) treats as immutable from a component.
        window.location.assign('/login');
        return;
      }
      await mutate();
    } catch {
      toast.error(t('deviceRevokeFailed'));
    } finally {
      setRevoking(null);
    }
  };

  const onSignOutAll = async () => {
    setSigningOutAll(true);
    try {
      // 1. Server-side blacklist: delete every auth session row so
      //    all refresh tokens are dead — other devices cannot renew.
      const revokeAll = await fetch('/api/v1/security/devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepCurrent: false }),
      });
      if (!revokeAll.ok) {
        toast.error(t('deviceRevokeFailed'));
        return;
      }
      // 2. Clear this browser's cookies via the normal sign-out.
      const response = await fetch('/api/v1/session', { method: 'DELETE' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string } | string;
        } | null;
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : (payload?.error?.message ?? 'Unable to sign out');
        toast.error(tp('signOutFailed', { message }));
        return;
      }
      window.location.href = '/login';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSigningOutAll(false);
    }
  };

  return (
    <>
      <Card className="py-0">
        <CardContent className="p-0">
          <div className="flex flex-col gap-6 p-5 md:flex-row md:gap-10">
            {/* Left rail */}
            <div className="md:w-52 md:shrink-0">
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                  <MonitorSmartphone className="size-3.5" aria-hidden="true" />
                </span>
                <h3 className="text-foreground text-sm font-semibold">
                  {t('devicesTitle')}
                </h3>
              </div>
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {t('devicesDesc')}
              </p>
              {data && data.length > 0 && (
                <p className="text-muted-foreground mt-3 text-xs">
                  <span className="text-foreground font-semibold">
                    {data.length}
                  </span>{' '}
                  {t('devicesCount', { count: data.length })}
                </p>
              )}
            </div>

            {/* Right: device list */}
            <div className="min-w-0 flex-1">
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
                <ul className="border-border divide-border divide-y rounded-lg border">
                  {data.map((device) => {
                    const agent = describeAgent(device.user_agent);
                    const Icon = agent.mobile ? Smartphone : Laptop;
                    return (
                      <li
                        key={device.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5',
                          device.is_current && 'bg-primary/[0.03]'
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            device.is_current
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-foreground truncate text-sm font-medium">
                              {agent.label}
                            </p>
                            {device.is_current && (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {t('deviceCurrent')}
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground truncate text-xs">
                            {device.location ? `${device.location} · ` : ''}
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
            </div>
          </div>

          {/* Footer: the global escape hatch */}
          <div className="border-border bg-muted/30 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs leading-relaxed">
              {tp('sessionsDesc')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmAllOpen(true)}
              className="shrink-0"
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              {tp('signOutAll')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tp('signOutConfirmTitle')}</DialogTitle>
            <DialogDescription>{tp('signOutConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmAllOpen(false)}
              disabled={signingOutAll}
            >
              {tp('cancel')}
            </Button>
            <Button
              type="button"
              onClick={onSignOutAll}
              disabled={signingOutAll}
            >
              {signingOutAll ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {tp('signingOut')}
                </>
              ) : (
                tp('signOutEverywhere')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
