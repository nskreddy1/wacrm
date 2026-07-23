"use client"

import useSWR from "swr"

import { navigationForAccess, type NavAccess, type NavGroupConfig } from "@/lib/navigation/config"

type NavigationResponse = { data: { groups: NavGroupConfig[] } }

/**
 * Backend-driven app navigation.
 *
 * `initialAccess` is resolved server-side by the dashboard layout and
 * threaded down, so the FIRST paint already contains the complete
 * permission-scoped nav — no restricted-subset flash followed by
 * extra items popping in after the API responds. The SWR fetch
 * remains as a background reconciliation (e.g. if the member's
 * profile permissions changed since the page was served), deduped
 * across sidebar instances.
 */
export function useNavigation(initialAccess: NavAccess | null = null): {
  groups: NavGroupConfig[]
  isLoading: boolean
} {
  const { data, isLoading } = useSWR<NavigationResponse>("/api/v1/workspace/navigation", {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
    fallbackData: { data: { groups: navigationForAccess(initialAccess) } },
  })

  return { groups: data?.data.groups ?? navigationForAccess(initialAccess), isLoading }
}
