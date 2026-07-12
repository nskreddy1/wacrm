"use client"

import { useCallback, useState } from "react"
import { AuthProvider } from "@/hooks/use-auth"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  return <div className="flex h-screen overflow-hidden bg-background">
    <Sidebar open={sidebarOpen} onClose={closeSidebar} />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Header onOpenSidebar={() => setSidebarOpen(true)} />
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  </div>
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><DashboardShellInner>{children}</DashboardShellInner></AuthProvider>
}
