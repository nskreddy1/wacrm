import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

type ChartCardProps = {
  title: string
  caption?: string
  /** e.g. "Last 14 days" chip or a custom control */
  meta?: ReactNode
  /** link rendered as "View all →" in the header */
  href?: string
  hrefLabel?: string
  children: ReactNode
  className?: string
  contentClassName?: string
}

/** Shared card shell for all dashboard widgets: header (title, caption, action) + content. */
export function ChartCard({ title, caption, meta, href, hrefLabel = "View all", children, className, contentClassName }: ChartCardProps) {
  return (
    <article className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-(--shadow-pipeline-card)", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {caption && <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{caption}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meta}
          {href && (
            <Link
              href={href}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary-soft"
            >
              {hrefLabel}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </header>
      <div className={cn("flex-1 p-4 sm:p-5", contentClassName)}>{children}</div>
    </article>
  )
}

/** Small muted chip for card headers, e.g. "Last 14 days". */
export function CardMetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-card-2 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}
