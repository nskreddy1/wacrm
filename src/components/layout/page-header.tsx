import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * PageHeader — the single source of truth for page-level headings.
 *
 * Every standard dashboard page renders exactly one of these at the top of
 * its PageContainer so the eyebrow / title / description / actions rhythm is
 * identical across the app.
 *
 * - `eyebrow`: the section the page belongs to (e.g. "Operations",
 *   "Engagement"). Rendered as a small primary-colored label.
 * - `backHref` / `backLabel`: detail pages (broadcast detail, automation
 *   logs) render a consistent back affordance instead of ad-hoc links.
 * - `actions`: right-aligned toolbar; wraps below the title on mobile.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel,
  className,
}: {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  backHref?: string
  backLabel?: string
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      {backHref && (
        <div>
          <Button
            render={<Link href={backHref} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            {backLabel ?? "Back"}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
