"use client"

import { useMemo, type ReactNode } from "react"
import { SWRConfig, type State } from "swr"

const DEFAULT_DEDUPE_MS = 15_000
const MAX_CACHE_ENTRIES = 150

export class BoundedMemoryCache<Value = State> extends Map<string, Value> {
  constructor(private readonly limit = MAX_CACHE_ENTRIES) {
    super()
  }

  override get(key: string) {
    const value = super.get(key)
    if (value !== undefined) {
      super.delete(key)
      super.set(key, value)
    }
    return value
  }

  override set(key: string, value: Value) {
    if (super.has(key)) super.delete(key)
    super.set(key, value)
    while (this.size > this.limit) {
      const oldest = this.keys().next().value
      if (oldest === undefined) break
      super.delete(oldest)
    }
    return this
  }
}

async function dashboardFetcher<T>(resource: RequestInfo | URL): Promise<T> {
  const response = await fetch(resource, {
    cache: "no-store",
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
  const provider = useMemo(() => new BoundedMemoryCache(), [])

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
