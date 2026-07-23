"use client"

import { AppSidebar } from "@/components/layout/app-sidebar"
import { DashboardCacheProvider } from "@/components/providers/dashboard-cache-provider"
import { TeamChatWidget } from "@/components/team-chat/team-chat-widget"
import { AssistantWidget } from "@/components/assistant/assistant-widget"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AuthProvider } from "@/hooks/use-auth"
import type { NavAccess } from "@/lib/navigation/config"
import type { SessionPayload } from "@/lib/auth/session-payload"

function DashboardShellInner({
  children,
  initialAccess,
}: {
  children: React.ReactNode
  initialAccess: NavAccess | null
}) {
  return (
    // h-dvh (not h-screen/100vh) tracks the *actual* dynamic viewport so the
    // shell never exceeds the visible area — 100vh can overshoot in embedded
    // previews and mobile browsers, producing a phantom page-level scrollbar
    // alongside the <main> scrollbar. overscroll-none stops scroll chaining.
    <SidebarProvider className="h-dvh overflow-hidden overscroll-none">
      <AppSidebar initialAccess={initialAccess} />
      <SidebarInset className="flex min-w-0 flex-col overflow-hidden">
        <main className="flex min-h-0 max-w-full flex-1 flex-col overflow-hidden">{children}</main>
      </SidebarInset>
      {/* Workspace-wide team chat (floating launcher, bottom-right). */}
      <TeamChatWidget />
      {/* Platform helper agent (floating launcher, bottom-left):
          read-only tools by default, write actions approved in-chat. */}
      <AssistantWidget />
    </SidebarProvider>
  )
}

export function DashboardShell({
  children,
  initialAccess = null,
  initialSession = null,
}: {
  children: React.ReactNode
  initialAccess?: NavAccess | null
  /**
   * Server-resolved session payload. Seeds AuthProvider's SWR cache so
   * the first client paint after login shows the real account/profile
   * instead of placeholders while /api/v1/session fetches.
   */
  initialSession?: SessionPayload | null
}) {
  // DashboardCacheProvider must wrap AuthProvider: AuthProvider's
  // useSWR("/api/v1/session") relies on the global fetcher configured
  // by SWRConfig — nested the other way, the session never fetches and
  // every consumer of useAuth() renders permanent fallbacks.
  return (
    <DashboardCacheProvider>
      <AuthProvider initialSession={initialSession}>
        <DashboardShellInner initialAccess={initialAccess}>{children}</DashboardShellInner>
      </AuthProvider>
    </DashboardCacheProvider>
  )
}
