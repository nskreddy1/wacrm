"use client"

import useSWR from "swr"

import { navigationForRole, type NavGroupConfig } from "@/lib/navigation/config"

type NavigationResponse = { data: { groups: NavGroupConfig[] } }

/**
 * Backend-driven app navigation. Renders instantly from the
 * viewer-safe static config, then reconciles with the role-scoped
 * server response (`/api/v1/workspace/navigation`). SWR dedupes
 * across the sidebar's desktop + mobile instances, so this costs
 * one request per session regardless of how many components use it.
 */
export function useNavigation(): { groups: NavGroupConfig[]; isLoading: boolean } {
  const { data, isLoading } = useSWR<NavigationResponse>("/api/v1/workspace/navigation", {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
    fallbackData: { data: { groups: navigationForRole(null) } },
  })

  return { groups: data?.data.groups ?? navigationForRole(null), isLoading }
}
