import { cn } from '@/lib/utils';

/**
 * PageContainer — the single source of truth for main-body spacing.
 *
 * Every standard dashboard page (settings-style content pages) MUST wrap
 * its content in this container so padding, max width, and vertical rhythm
 * are identical across the app. Full-bleed workspaces (Inbox, Pipelines,
 * Contacts) manage their own edge-to-edge layouts and skip it.
 *
 * Widths:
 * - "default": 1500px cap — list pages and dashboards.
 * - "narrow":  920px cap — focused flows (composers, wizards, log views).
 * - "full":    no cap — dense tabular pages that want the whole viewport.
 *
 * Rhythm: px-3 py-4 sm:p-6 lg:p-8 padding with a flex column gap-6 between
 * page header and content sections.
 */
type PageWidth = 'default' | 'narrow' | 'full';

const widthClass: Record<PageWidth, string> = {
  default: 'max-w-[1500px]',
  narrow: 'max-w-[920px]',
  full: '',
};

/**
 * Class string for pages that must merge the standard container with
 * their own top-level element. Use `cn(pageContainerClassName, "...")`
 * — keep both in sync with PageContainer's "default" width.
 */
export const pageContainerClassName =
  'app-scrollbar mx-auto h-0 min-h-0 w-full max-w-[1500px] flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:p-6 lg:p-8';

export function PageContainer({
  children,
  className,
  width = 'default',
}: {
  children: React.ReactNode;
  className?: string;
  width?: PageWidth;
}) {
  return (
    <div
      className={cn(
        'app-scrollbar mx-auto flex h-0 min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-3 py-4 sm:p-6 lg:p-8',
        widthClass[width],
        className
      )}
    >
      {children}
    </div>
  );
}
