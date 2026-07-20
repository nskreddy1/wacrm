"use client"

import { Trophy, XCircle } from "lucide-react"
import { AnimatedBar } from "@/components/ui/animated-bar"
import { AnimatedNumber } from "@/components/ui/animated-number"

type PipelineFunnelProps = {
  stages: Array<{ name: string; count: number; value: number }>
  wonValue30d: number
  wonCount30d: number
  lostCount30d: number
  currency: string
}

/** Deals by stage as a horizontal bar funnel + won/lost 30d summary. */
export function PipelineFunnel({ stages, wonValue30d, wonCount30d, lostCount30d, currency }: PipelineFunnelProps) {
  const maxValue = Math.max(...stages.map((s) => s.value), 1)
  const money: Intl.NumberFormatOptions = { style: "currency", currency, maximumFractionDigits: 0 }
  const moneyFormatter = new Intl.NumberFormat("en", money)

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-1 flex-col gap-3">
        {stages.map((stage, i) => {
          const pct = Math.max(4, Math.round((stage.value / maxValue) * 100))
          return (
            <div key={stage.name} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">{stage.name}</span>
                <span className="text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {stage.count} {stage.count === 1 ? "deal" : "deals"} · {moneyFormatter.format(stage.value)}
                </span>
              </div>
              <AnimatedBar
                percent={pct}
                delay={i * 0.06}
                color={`color-mix(in oklch, var(--primary) ${100 - i * 16}%, var(--muted))`}
                className="h-2.5"
              />
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-positive/10 text-positive">
            <Trophy className="size-4" aria-hidden="true" />
          </div>
          <div>
            <AnimatedNumber value={wonValue30d} format={money} className="text-sm font-semibold leading-tight" />
            <p className="text-[11px] text-muted-foreground">{`Won · ${wonCount30d} deals (30d)`}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <XCircle className="size-4" aria-hidden="true" />
          </div>
          <div>
            <AnimatedNumber value={lostCount30d} className="text-sm font-semibold leading-tight" />
            <p className="text-[11px] text-muted-foreground">Lost deals (30d)</p>
          </div>
        </div>
      </div>
    </div>
  )
}
