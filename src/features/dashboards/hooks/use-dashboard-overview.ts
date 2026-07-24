'use client';

import useSWR from 'swr';

import type { DashboardOverview } from '@/lib/data/dashboard/types';

type DashboardResponse = {
  data: DashboardOverview;
  meta: { source: string };
};

/**
 * Live dashboard overview — refreshes on focus and every 60s so the
 * "command center" stays close to realtime without a socket.
 */
export function useDashboardOverview() {
  const { data, error, isLoading, mutate } = useSWR<DashboardResponse>(
    '/api/v1/dashboard',
    {
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    }
  );

  return {
    overview: data?.data ?? null,
    error,
    isLoading,
    refresh: mutate,
  };
}
