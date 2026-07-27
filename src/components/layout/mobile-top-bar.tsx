'use client';

import Link from 'next/link';

import { AxonMark } from '@/features/brand/components/axon-logo';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useTotalUnread } from '@/features/inbox/hooks/use-total-unread';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { workspaceDisplayName } from '@/lib/display-name';
import { routes } from '@/lib/routing/routes';

/**
 * MobileTopBar — the only way to reach navigation below `md`.
 *
 * On mobile the sidebar renders as an off-canvas sheet, and shadcn's
 * `SidebarRail` is `hidden sm:flex`, so without this bar there is no
 * affordance at all to open the nav — mobile users were locked into
 * whatever page they landed on.
 *
 * It lives in the dashboard shell (not in individual pages) so every
 * route gets it for free, including full-bleed workspaces like Inbox
 * and Pipelines that skip PageContainer.
 *
 * `md:hidden` matches the 768px `useIsMobile` breakpoint that flips
 * the sidebar into sheet mode, so the bar appears exactly when the
 * rail disappears — never both, never neither.
 */
export function MobileTopBar() {
  const { account, loading } = useAuth();
  // The sidebar owns the single Realtime subscription for this data;
  // this bar reads the shared SWR cache so no duplicate channel opens.
  const unreadCount = useTotalUnread({ subscribe: false });

  return (
    <header className="bg-background border-border flex h-14 shrink-0 items-center gap-2 border-b px-3 md:hidden">
      {/* Opens the nav sheet. `relative` anchors the unread dot so an
          unread conversation is still discoverable while the nav is
          closed — otherwise the badge is hidden inside the sheet. */}
      <div className="relative shrink-0">
        <SidebarTrigger
          aria-label="Open navigation"
          className="size-9 [&_svg]:size-5"
        />
        {unreadCount > 0 && (
          <span
            className="bg-primary absolute end-1 top-1 size-2 rounded-full"
            aria-hidden="true"
          />
        )}
      </div>

      <Link
        href={routes.app.dashboard}
        aria-label="Workspace dashboard"
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <AxonMark size={22} variant="mono" aria-hidden="true" />
        {loading && !account ? (
          <span
            className="bg-muted h-3.5 w-24 animate-pulse rounded"
            aria-hidden="true"
          />
        ) : (
          <span className="truncate text-sm font-semibold">
            {workspaceDisplayName(account?.name)}
          </span>
        )}
      </Link>
    </header>
  );
}
