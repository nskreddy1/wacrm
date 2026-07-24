"use client"

import type { ComponentType } from "react"
import Link from "next/link"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { cn } from "@/lib/utils"

type KpiCardProps = {
  label: string
  value: number
  /** Intl format for the value (e.g. currency) */
  format?: Intl.NumberFormatOptions
  /** Percentage change vs previous period; omit or null hides the delta chip. */
  delta?: number | null
  /** small line under the value, e.g. "9 unassigned" */
  detail?: string
  /** rendered right after the value, e.g. "%" */
  suffix?: string
  icon: ComponentType<{ className?: string }>
  href: string
}

/**
 * KPI stat card: icon, label, animated value, delta chip, link.
 * Value uses an AnimatedNumber ticker so realtime refreshes roll smoothly.
 */
export function KpiCard({ label, value, format, delta, detail, suffix, icon: Icon, href }: KpiCardProps) {
  const negative = delta != null && delta < 0
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col rounded-xl border border-border bg-card p-4 shadow-(--shadow-pipeline-card)",
        "transition-[transform,border-color] duration-150 ease-out hover:border-primary/40 active:scale-[0.98]",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        {delta != null && (
          <span
            className={cn(
              "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
              negative ? "bg-destructive/10 text-destructive" : "bg-positive/10 text-positive",
            )}
          >
            {negative ? <ArrowDownRight className="size-3" aria-hidden="true" /> : <ArrowUpRight className="size-3" aria-hidden="true" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      <p className="mt-4 text-[26px] font-semibold leading-none tracking-tight">
        <AnimatedNumber value={value} format={format} />
        {suffix && <span className="text-lg text-muted-foreground">{suffix}</span>}
      </p>
      <p className="mt-2 text-[13px] font-medium text-foreground/90">{label}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </Link>
  )
}
