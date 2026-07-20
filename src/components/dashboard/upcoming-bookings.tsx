"use client"

import Link from "next/link"
import { CalendarClock } from "lucide-react"

import type { DashboardOverview } from "./demo-data"
import { ChartCard } from "./chart-card"
import { ChannelBadge } from "@/components/ui/channel-badge"

type Booking = DashboardOverview["bookings"][number]

/** Next scheduled bookings, soonest first. */
export function UpcomingBookings({ bookings }: { bookings: Booking[] }) {
  return (
    <ChartCard
      title="Upcoming bookings"
      caption="Next scheduled appointments"
      href="/bookings"
      contentClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {bookings.map((b) => (
          <li key={b.id}>
            <Link
              href="/bookings"
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <CalendarClock className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{b.contact}</span>
                  <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">{b.when}</span>
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ChannelBadge channel={b.channel} compact />
                  <span className="truncate">{b.service}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
