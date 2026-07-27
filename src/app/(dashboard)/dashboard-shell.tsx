'use client';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { MobileTopBar } from '@/components/layout/mobile-top-bar';
import { DashboardCacheProvider } from '@/components/providers/dashboard-cache-provider';
import { TeamChatWidget } from '@/features/team-chat/components/team-chat-widget';
import { AssistantWidget } from '@/features/assistant/components/assistant-widget';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AuthProvider } from '@/features/auth/hooks/use-auth';
import { WelcomeGate } from '@/features/onboarding/components/welcome-gate';
import type { NavAccess } from '@/lib/navigation/config';
import type { SessionPayload } from '@/features/auth/lib/session-payload';

function DashboardShellInner({
  children,
  initialAccess,
}: {
  children: React.ReactNode;
  initialAccess: NavAccess | null;
}) {
  return (
    // h-dvh (not h-screen/100vh) tracks the *actual* dynamic viewport so the
    // shell never exceeds the visible area — 100vh can overshoot in embedded
    // previews and mobile browsers, producing a phantom page-level scrollbar
    // alongside the <main> scrollbar. overscroll-none stops scroll chaining.
    <SidebarProvider className="h-dvh overflow-hidden overscroll-none">
      <AppSidebar initialAccess={initialAccess} />
      <SidebarInset className="flex min-w-0 flex-col overflow-hidden">
        {/* Below md the sidebar becomes an off-canvas sheet and the drag
            rail is hidden, so this bar carries the only trigger that can
            open navigation. Lives here (not per page) so every route —
            including full-bleed ones like Inbox — gets it. shrink-0 keeps
            it fixed while the content region absorbs the remaining height. */}
        <MobileTopBar />
        {/* A plain <div>, not <main>: SidebarInset already renders the
            page's <main> landmark, so wrapping children in another one
            gave every dashboard route two "main" landmarks (WCAG 1.3.1). */}
        <div className="flex min-h-0 max-w-full flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </SidebarInset>
      {/* Workspace-wide team chat (floating launcher, bottom-right). */}
      <TeamChatWidget />
      {/* Platform helper agent (floating launcher, bottom-left):
          read-only tools by default, write actions approved in-chat. */}
      <AssistantWidget />
      {/* Full-screen 3D welcome overlay — only when ?welcome=1 (set
          after login and after finishing the onboarding wizard). */}
      <WelcomeGate />
    </SidebarProvider>
  );
}

export function DashboardShell({
  children,
  initialAccess = null,
  initialSession = null,
}: {
  children: React.ReactNode;
  initialAccess?: NavAccess | null;
  /**
   * Server-resolved session payload. Seeds AuthProvider's SWR cache so
   * the first client paint after login shows the real account/profile
   * instead of placeholders while /api/v1/session fetches.
   */
  initialSession?: SessionPayload | null;
}) {
  // DashboardCacheProvider must wrap AuthProvider: AuthProvider's
  // useSWR("/api/v1/session") relies on the global fetcher configured
  // by SWRConfig — nested the other way, the session never fetches and
  // every consumer of useAuth() renders permanent fallbacks.
  return (
    <DashboardCacheProvider>
      <AuthProvider initialSession={initialSession}>
        <DashboardShellInner initialAccess={initialAccess}>
          {children}
        </DashboardShellInner>
      </AuthProvider>
    </DashboardCacheProvider>
  );
}
