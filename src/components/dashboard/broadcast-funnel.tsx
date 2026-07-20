"use client"

import Link from "next/link"
import { AlertTriangle, Clock3, Loader2 } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { ChannelBadge } from "@/components/ui/channel-badge"
import { cn } from "@/lib/utils"

type BroadcastFunnelProps = {
  totals: { sent: number; delivered: number; read: number; replied: number; failed: number }
  whatsappEnabled: boolean
  recent: Array<{
    id: string
    name: string
    channel: "whatsapp" | "sms"
    status: "sent" | "sending" | "scheduled" | "failed"
    totalRecipients: number
    sent: number
    delivered: number
    read: number
    failed: number
    createdAt: string
  }>
}

const FUNNEL_STEPS = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
  { key: "replied", label: "Replied" },
] as const

const STATUS_META: Record<BroadcastFunnelProps["recent"][number]["status"], { label: string; className: string }> = {
  sent: { label: "Sent", className: "bg-positive/10 text-positive" },
  sending: { label: "Sending", className: "bg-primary-soft text-primary" },
  scheduled: { label: "Scheduled", className: "bg-muted text-muted-foreground" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
}

/** Broadcast performance: sent→delivered→read→replied funnel + recent broadcasts list. */
export function BroadcastFunnel({ totals, whatsappEnabled, recent }: BroadcastFunnelProps) {
  const max = Math.max(totals.sent, 1)

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Funnel */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FUNNEL_STEPS.map((step, i) => {
          const value = totals[step.key]
          const pct = Math.round((value / max) * 100)
          return (
            <div key={step.key} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card-2 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">{step.label}</p>
              <AnimatedNumber value={value} className="text-lg font-semibold leading-none" />
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(pct, 3)}%`,
                    background: `color-mix(in oklch, var(--primary) ${100 - i * 14}%, var(--muted))`,
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                {pct}% of sent
              </p>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{totals.failed.toLocaleString("en")} failed deliveries</span>
      </div>

      {/* WhatsApp pending approval notice */}
      {!whatsappEnabled && (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card-2 p-3">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-channel-whatsapp" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold">WhatsApp broadcasts pending template approval</p>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              SMS broadcasts are live. WhatsApp campaigns unlock once your message templates are approved by Meta.
            </p>
          </div>
        </div>
      )}

      {/* Recent broadcasts */}
      <div className="flex flex-col divide-y divide-border border-t border-border">
        {recent.map((b) => {
          const status = STATUS_META[b.status]
          const deliveredPct = b.sent > 0 ? Math.round((b.delivered / b.sent) * 100) : 0
          return (
            <Link key={b.id} href="/broadcasts" className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{b.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <ChannelBadge channel={b.channel} compact />
                  <span className="text-[11px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {b.totalRecipients.toLocaleString("en")} recipients
                    {b.status !== "scheduled" && ` · ${deliveredPct}% delivered`}
                  </span>
                </div>
              </div>
              <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", status.className)}>
                {b.status === "sending" && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {status.label}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
