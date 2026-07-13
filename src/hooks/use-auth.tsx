"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { User } from "@supabase/supabase-js"
import useSWR from "swr"
import { demoSession } from "@/lib/demo/crm-data"
import { DEFAULT_CURRENCY } from "@/lib/currency"
import type { AccountRole } from "@/lib/auth/roles"

type Profile = Omit<typeof demoSession.profile, "account_role"> & { account_role: AccountRole }
type AccountSummary = typeof demoSession.account

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
  isOwner: boolean
  isAdmin: boolean
  isAgent: boolean
  isViewer: boolean
  canManageMembers: boolean
  canEditSettings: boolean
  canSendMessages: boolean
}

type SessionPayload = {
  data: {
    user: typeof demoSession.user
    profile: Profile
    account: AccountSummary
  }
  meta: { source: "mock" | "supabase" }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useSWR<SessionPayload>("/api/v1/session")
  const session = data?.data
  const role = session?.profile.account_role ?? null

  const value = useMemo<AuthContextValue>(() => ({
    user: (session?.user as User | undefined) ?? null,
    profile: session?.profile ?? null,
    loading: isLoading,
    profileLoading: isLoading,
    signOut: async () => { window.location.href = "/dashboard" },
    refreshProfile: async () => { await mutate() },
    accountId: session?.account.id ?? null,
    accountRole: role,
    account: session?.account ?? null,
    defaultCurrency: session?.account.default_currency ?? DEFAULT_CURRENCY,
    isOwner: role === "owner",
    isAdmin: role === "admin",
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
