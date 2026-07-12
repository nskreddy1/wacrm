"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { User } from "@supabase/supabase-js"
import { demoSession } from "@/lib/demo/crm-data"
import { DEFAULT_CURRENCY } from "@/lib/currency"
import type { AccountRole } from "@/lib/auth/roles"

type Profile = typeof demoSession.profile
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

const DEMO_USER = demoSession.user as User
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(() => ({
    user: DEMO_USER,
    profile: demoSession.profile,
    loading: false,
    profileLoading: false,
    signOut: async () => { window.location.href = "/dashboard" },
    refreshProfile: async () => {},
    accountId: demoSession.account.id,
    accountRole: "owner",
    account: demoSession.account,
    defaultCurrency: demoSession.account.default_currency ?? DEFAULT_CURRENCY,
    isOwner: true,
    isAdmin: false,
    isAgent: false,
    isViewer: false,
    canManageMembers: true,
    canEditSettings: true,
    canSendMessages: true,
  }), [])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used within AuthProvider")
  return value
}
