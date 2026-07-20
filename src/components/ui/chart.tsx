"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/* Lightweight chart primitives shared by every Recharts chart in the
 * app: a themed tooltip and a legend. All colors come from CSS tokens
 * so charts adapt to every accent theme + light/dark mode. */

type TooltipEntry = {
  name?: string | number
  value?: number | string
  color?: string
  dataKey?: string | number
}

type ChartTooltipContentProps = {
  active?: boolean
  label?: ReactNode
  payload?: TooltipEntry[]
  /** map dataKey -> display label */
  labels?: Record<string, string>
  /** format numeric values, e.g. currency */
  valueFormatter?: (value: number) => string
}

export function ChartTooltipContent({ active, label, payload, labels, valueFormatter }: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label != null && <p className="mb-1.5 font-medium text-popover-foreground">{label}</p>}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => {
          const key = String(entry.dataKey ?? entry.name ?? i)
          const numeric = typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0)
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 shrink-0 rounded-[3px]" style={{ background: entry.color }} aria-hidden="true" />
                {labels?.[key] ?? entry.name ?? key}
              </span>
              <span className="font-semibold text-popover-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                {valueFormatter ? valueFormatter(numeric) : numeric.toLocaleString("en")}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ChartLegendProps = {
  items: Array<{ label: string; color: string }>
  className?: string
}

export function ChartLegend({ items, className }: ChartLegendProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 shrink-0 rounded-[3px]" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  )
}
