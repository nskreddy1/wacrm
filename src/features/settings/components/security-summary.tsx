'use client';

import useSWR from 'swr';
import { useTranslations, useFormatter, useNow } from 'next-intl';
import {
  MonitorSmartphone,
  Clock3,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

import { cn } from '@/lib/utils';

interface DeviceRow {
  id: string;
  last_seen_at: string;
}

interface AttemptRow {
  id: string;
  success: boolean;
  created_at: string;
}

const fetcher = async <T,>(url: string): Promise<T[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load');
  const body = (await res.json()) as { data: T[] };
  return body.data;
};

/**
 * Security health strip — answers "is my account safe?" in one
 * glance before the user reads a single form. Four facts: active
 * devices, last sign-in, failed attempts (7 days), and the lockout
 * policy that is always protecting the account. SWR keys are shared
 * with the cards below, so this costs no extra requests.
 */
export function SecuritySummary() {
  const t = useTranslations('Settings.security');
  const format = useFormatter();
  // Seeded from the request-level `now` (src/i18n/request.ts) so the "last
  // sign-in" tile renders identically on the server and on hydration, then
  // refreshes each minute rather than freezing at page load.
  const now = useNow({ updateInterval: 60_000 });

  const { data: devices } = useSWR(
    '/api/v1/security/devices',
    fetcher<DeviceRow>,
    { revalidateOnFocus: false }
  );
  const { data: attempts } = useSWR(
    '/api/v1/security/login-activity',
    fetcher<AttemptRow>,
    { revalidateOnFocus: false }
  );

  // Derived from the same `now` the relative-time label uses, rather than a
  // fresh `Date.now()`. Reading the clock during render is impure — the React
  // Compiler flags it, and it also meant the "failed attempts (7 days)" window
  // and the "last sign-in" label could be measured from two different
  // instants on the same paint.
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const failed7d =
    attempts?.filter(
      (a) => !a.success && new Date(a.created_at).getTime() >= weekAgo
    ).length ?? 0;
  const lastSuccess = attempts?.find((a) => a.success);

  const tiles = [
    {
      icon: MonitorSmartphone,
      label: t('summaryDevices'),
      value: devices ? String(devices.length) : '—',
      tone: 'neutral' as const,
    },
    {
      icon: Clock3,
      label: t('summaryLastLogin'),
      value: lastSuccess
        ? format.relativeTime(new Date(lastSuccess.created_at), now)
        : '—',
      tone: 'neutral' as const,
    },
    {
      icon: ShieldAlert,
      label: t('summaryFailed'),
      value: attempts ? String(failed7d) : '—',
      tone: failed7d > 0 ? ('warn' as const) : ('ok' as const),
    },
    {
      icon: ShieldCheck,
      label: t('summaryLockout'),
      value: t('summaryLockoutValue'),
      tone: 'ok' as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="border-border bg-card flex items-center gap-3 rounded-lg border px-3.5 py-3"
        >
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              tile.tone === 'warn'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
                : tile.tone === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500'
                  : 'bg-primary/10 text-primary'
            )}
          >
            <tile.icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-muted-foreground truncate text-[11px] font-medium tracking-wide uppercase">
              {tile.label}
            </p>
            <p className="text-foreground truncate text-sm font-semibold">
              {tile.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
