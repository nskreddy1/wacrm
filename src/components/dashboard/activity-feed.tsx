"use client"

import Link from "next/link"
import type { ComponentType } from "react"
import {
  Briefcase,
  CalendarCheck,
  MessageSquare,
  Radio,
  UserPlus,
} from "lucide-react"

import type { DashboardOverview } from "./demo-data"
import { ChartCard } from "./chart-card"
import { cn } from "@/lib/utils"

type ActivityItem = DashboardOverview["activity"][number]

const KIND_ICON: Record<ActivityItem["type"], ComponentType<{ className?: string }>> = {
  message: MessageSquare,
  broadcast: Radio,
  deal: Briefcase,
  contact: UserPlus,
  booking: CalendarCheck,
}

const KIND_BADGE: Record<ActivityItem["type"], string> = {
  message: "bg-[var(--channel-whatsapp)]/10 text-[var(--channel-whatsapp)]",
  broadcast: "bg-[var(--chart-4)]/10 text-[var(--chart-4)]",
  deal: "bg-primary/10 text-primary",
  contact: "bg-[var(--channel-sms)]/10 text-[var(--channel-sms)]",
  booking: "bg-[var(--chart-5)]/10 text-[var(--chart-5)]",
}

export function ActivityFeed({ items, className }: { items: ActivityItem[]; className?: string }) {
  return (
    <ChartCard
      title="Recent activity"
      caption="Latest events across channels, broadcasts and deals"
      href="/inbox"
      hrefLabel="View inbox"
      className={className}
      contentClassName="scrollbar-invisible max-h-80 overflow-y-auto overscroll-contain p-0"
    >
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const Icon = KIND_ICON[item.type]
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    KIND_BADGE[item.type],
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {item.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {item.time}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
