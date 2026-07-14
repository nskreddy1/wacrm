"use client"

import { useCallback, useState } from "react"

import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"
import { DashboardCacheProvider } from "@/components/providers/dashboard-cache-provider"
import { AuthProvider } from "@/hooks/use-auth"

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    // h-dvh (not h-screen/100vh) tracks the *actual* dynamic viewport so the
    // shell never exceeds the visible area — 100vh can overshoot in embedded
    // previews and mobile browsers, producing a phantom page-level scrollbar
    // alongside the <main> scrollbar. overscroll-none stops scroll chaining.
    <div className="flex h-dvh overflow-hidden overscroll-none bg-background">
      <Sidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={closeSidebar}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="min-h-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  // DashboardCacheProvider must wrap AuthProvider: AuthProvider's
  // useSWR("/api/v1/session") relies on the global fetcher configured
  // by SWRConfig — nested the other way, the session never fetches and
  // every consumer of useAuth() renders permanent fallbacks.
  return (
    <DashboardCacheProvider>
      <AuthProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </AuthProvider>
    </DashboardCacheProvider>
  )
}
