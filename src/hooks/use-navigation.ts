"use client"

import useSWR from "swr"

import { navigationForRole, type NavGroupConfig } from "@/lib/navigation/config"
import type { AccountRole } from "@/lib/auth/roles"

type NavigationResponse = { data: { groups: NavGroupConfig[] } }

/**
 * Backend-driven app navigation.
 *
 * `initialRole` is resolved server-side by the dashboard layout and
 * threaded down, so the FIRST paint already contains the complete
 * role-scoped nav — no viewer-subset flash followed by extra items
 * popping in after the API responds. The SWR fetch remains as a
 * background reconciliation (e.g. if the user's role changed since
 * the page was served), deduped across sidebar instances.
 */
export function useNavigation(initialRole: AccountRole | null = null): {
  groups: NavGroupConfig[]
  isLoading: boolean
} {
  const { data, isLoading } = useSWR<NavigationResponse>("/api/v1/workspace/navigation", {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
    fallbackData: { data: { groups: navigationForRole(initialRole) } },
  })

  return { groups: data?.data.groups ?? navigationForRole(initialRole), isLoading }
}
