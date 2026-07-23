"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { User } from "@supabase/supabase-js"
import useSWR from "swr"
import { DEFAULT_CURRENCY } from "@/lib/currency"
import type { AccountRole } from "@/lib/auth/roles"
import {
  deriveCapabilities,
  hasPermission,
  type PermissionSlug,
} from "@/lib/auth/permissions"
// Type-only import: erased at build time, so the "server-only" guard
// inside session-payload.ts never runs in this client module. Sharing
// the type guarantees the SSR-provided fallback session and the
// client-fetched session can never drift in shape.
import type {
  SessionAccount as AccountSummary,
  SessionPayload,
  SessionProfile as Profile,
} from "@/lib/auth/session-payload"

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  profileLoading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  accountId: string | null
  accountRole: AccountRole | null
  account: AccountSummary | null
  defaultCurrency: string
  /** Workspace owner — the "Super Admin" profile; holds every permission. */
  isOwner: boolean
  isAdmin: boolean
  /** Platform-level operator (profiles.is_super_admin). Orthogonal to workspace tiers. */
  isSuperAdmin: boolean
  isAgent: boolean
  isViewer: boolean
  canManageMembers: boolean
  canEditSettings: boolean
  canSendMessages: boolean
  /** Permission slugs from the member's workspace profile. */
  permissions: readonly string[]
  /** Assigned workspace profile (permission set), if any. */
  workspaceProfile: { id: string; name: string } | null
  /** True iff the member holds `slug` (owners always pass). */
  can: (slug: PermissionSlug) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode
  initialSession?: SessionPayload | null
}) {
  // PERF: `fallbackData` seeds SWR with the session the server layout
  // already resolved during SSR — the first paint after login renders
  // the real profile/account immediately (isLoading is false) instead
  // of placeholder text that pops in when a client fetch resolves.
  // SWR still revalidates in the background per the cache provider's
  // config, so subsequent profile/account edits propagate normally.
  const { data, isLoading, mutate } = useSWR<SessionPayload>(
    "/api/v1/session",
    initialSession ? { fallbackData: initialSession } : undefined,
  )
  const session = data?.data
  const role = session?.profile.account_role ?? null
  const permissions = session?.profile.permissions ?? []
  const isOwner = session?.profile.is_owner === true
  const caps = deriveCapabilities(permissions, isOwner)

  const value = useMemo<AuthContextValue>(() => ({
    user: (session?.user as User | undefined) ?? null,
    profile: session?.profile ?? null,
    loading: isLoading,
    profileLoading: isLoading,
    signOut: async () => {
      await fetch("/api/v1/session", { method: "DELETE" })
      window.location.href = "/login"
    },
    refreshProfile: async () => { await mutate() },
    accountId: session?.account.id ?? null,
    accountRole: role,
    account: session?.account ?? null,
    defaultCurrency: session?.account.default_currency ?? DEFAULT_CURRENCY,
    isOwner: role === "owner",
    isAdmin: role === "admin",
    isSuperAdmin: session?.profile.is_super_admin === true,
    isAgent: role === "agent",
    isViewer: role === "viewer",
    canManageMembers: role === "owner" || role === "admin",
    canEditSettings: role === "owner" || role === "admin",
    canSendMessages: role !== null && role !== "viewer",
  }), [isLoading, mutate, role, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used within AuthProvider")
  return value
}
