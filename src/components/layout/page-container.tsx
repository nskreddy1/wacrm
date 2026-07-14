import { cn } from "@/lib/utils"

/**
 * PageContainer — the single source of truth for main-body spacing.
 *
 * Every standard dashboard page (settings-style content pages) MUST wrap
 * its content in this container so padding, max width, and vertical rhythm
 * are identical across the app. Full-bleed workspaces (Inbox, Pipelines,
 * Contacts, Bookings) manage their own edge-to-edge layouts and skip it.
 *
 * Matches the dashboard's established rhythm: p-4 sm:p-6 lg:p-8, capped
 * at 1500px and centered on wide screens.
 */
/**
 * Class string for pages that must merge the standard container with
 * their own top-level element (e.g. list pages with `space-y-6`).
 * Use `cn(pageContainerClassName, "...")` — keep both in sync.
 */
export const pageContainerClassName = "mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8"

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn(pageContainerClassName, className)}>
      {children}
    </div>
  )
}
