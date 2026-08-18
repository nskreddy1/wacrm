'use client';

import useSWR from 'swr';
import { useTranslations, useFormatter, useNow } from 'next-intl';
import { CheckCircle2, History, XCircle } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
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
 * Recent login activity — successes and failures with location, in
 * the same split left-rail structure as the password and devices
 * sections. Visibility of auth events is the core "secure by
 * design" pattern: a user who can SEE a failed attempt from an
 * unknown city knows to rotate their password before it becomes a
 * breach.
 */
export function LoginActivityCard() {
  const t = useTranslations('Settings.security');
  const format = useFormatter();
  // Explicit reference point for the "x minutes ago" labels below. It is
  // seeded from the request-level `now` (see src/i18n/request.ts), so the
  // first client render matches the server's markup, then ticks every
  // minute — which is the granularity these labels actually show.
  const now = useNow({ updateInterval: 60_000 });
  const { data, isLoading } = useSWR(
    '/api/v1/security/login-activity',
    fetcher,
    { revalidateOnFocus: false }
  );

  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <div className="flex flex-col gap-6 p-5 md:flex-row md:gap-10">
          {/* Left rail: what this section is and why it matters */}
          <div className="md:w-52 md:shrink-0">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                <History className="size-3.5" aria-hidden="true" />
              </span>
              <h3 className="text-foreground text-sm font-semibold">
                {t('activityTitle')}
              </h3>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {t('activityDesc')}
            </p>
          </div>

          {/* Right: the attempt timeline */}
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <p className="text-muted-foreground py-2 text-sm">
                {t('activityLoading')}
              </p>
            ) : !data || data.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">
                {t('activityEmpty')}
              </p>
            ) : (
              <ul className="border-border divide-border divide-y rounded-lg border">
                {data.map((attempt) => (
                  <li
                    key={attempt.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5',
                      !attempt.success && 'bg-destructive/[0.03]'
                    )}
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
                          'truncate text-sm font-medium',
                          attempt.success
                            ? 'text-foreground'
                            : 'text-destructive'
                        )}
                      >
                        {attempt.success
                          ? t('activitySuccess')
                          : t('activityFailure')}
                        {attempt.location ? ` · ${attempt.location}` : ''}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {attempt.ip_address ?? '—'} ·{' '}
                        {format.relativeTime(new Date(attempt.created_at), now)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
