"use client"

import { useMemo, type ReactNode } from "react"
import { SWRConfig } from "swr"

const DEFAULT_DEDUPE_MS = 15_000

async function dashboardFetcher<T>(resource: RequestInfo | URL): Promise<T> {
  const response = await fetch(resource, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? `Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function DashboardCacheProvider({ children }: { children: ReactNode }) {
  const provider = useMemo(() => new Map(), [])

  return (
    <SWRConfig
      value={{
        provider: () => provider,
        fetcher: dashboardFetcher,
        dedupingInterval: DEFAULT_DEDUPE_MS,
        focusThrottleInterval: 30_000,
        errorRetryCount: 3,
        errorRetryInterval: 2_000,
        keepPreviousData: true,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        shouldRetryOnError: true,
      }}
    >
      {children}
    </SWRConfig>
  )
}
