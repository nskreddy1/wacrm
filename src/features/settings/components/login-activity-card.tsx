'use client';

import useSWR from 'swr';
import { useTranslations, useFormatter } from 'next-intl';
import { CheckCircle2, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

interface AttemptRow {
  id: string;
  success: boolean;
  ip_address: string | null;
  location: string;
  created_at: string;
}

const fetcher = async (url: string): Promise<AttemptRow[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load login activity');
  const body = (await res.json()) as { data: AttemptRow[] };
  return body.data;
};

/**
 * Recent login activity — successes and failures with location.
 * Visibility of auth events is the core "secure by design" pattern:
 * a user who can SEE a failed attempt from an unknown city knows to
 * rotate their password before it becomes a breach.
 */
export function LoginActivityCard() {
  const t = useTranslations('Settings.security');
  const format = useFormatter();
  const { data, isLoading } = useSWR('/api/v1/security/login-activity', fetcher, {
    revalidateOnFocus: false,
  });

  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
      <div className="border-border flex flex-col gap-1 border-b px-5 py-4">
        <h3 className="text-foreground text-sm font-semibold">
          {t('activityTitle')}
        </h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t('activityDesc')}
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground px-5 py-4 text-xs">
          {t('activityLoading')}
        </p>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground px-5 py-4 text-xs">
          {t('activityEmpty')}
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {data.map((attempt) => (
            <li
              key={attempt.id}
              className="flex items-center gap-3 px-5 py-2.5"
            >
              {attempt.success ? (
                <CheckCircle2
                  className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500"
                  aria-hidden="true"
                />
              ) : (
                <XCircle
                  className="text-destructive size-4 shrink-0"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-xs font-medium',
                    attempt.success ? 'text-foreground' : 'text-destructive'
                  )}
                >
                  {attempt.success
                    ? t('activitySuccess')
                    : t('activityFailure')}
                  {attempt.location ? ` · ${attempt.location}` : ''}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {attempt.ip_address ?? '—'} ·{' '}
                  {format.relativeTime(new Date(attempt.created_at))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
