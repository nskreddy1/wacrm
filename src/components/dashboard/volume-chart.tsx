"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import type { VolumePoint } from "@/lib/data/dashboard/types"
import { ChartLegend, ChartTooltipContent } from "@/components/ui/chart"
import { channelColorVar } from "@/components/ui/channel-badge"

const dayFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

/** 14-day message volume, stacked by channel. Email only renders when present. */
export function VolumeChart({ data }: { data: VolumePoint[] }) {
  const chartData = data.map((d) => ({ ...d, label: dayFormatter.format(new Date(`${d.day}T00:00:00`)) }))
  const hasEmail = data.some((d) => d.email > 0)

  const legend = [
    { label: "WhatsApp", color: channelColorVar("whatsapp") },
    { label: "SMS", color: channelColorVar("sms") },
    ...(hasEmail ? [{ label: "Email", color: "var(--chart-4)" }] : []),
  ]

  return (
    <div className="flex h-full flex-col gap-3">
      <ChartLegend items={legend} />
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: -18 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis tickLine={false} axisLine={false} width={40} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip
              cursor={{ fill: "color-mix(in oklch, var(--foreground) 5%, transparent)" }}
              isAnimationActive={false}
              content={<ChartTooltipContent labels={{ whatsapp: "WhatsApp", sms: "SMS", email: "Email" }} />}
            />
            <Bar dataKey="whatsapp" stackId="volume" fill={channelColorVar("whatsapp")} isAnimationActive={false} />
            <Bar
              dataKey="sms"
              stackId="volume"
              fill={channelColorVar("sms")}
              radius={hasEmail ? undefined : [3, 3, 0, 0]}
              isAnimationActive={false}
            />
            {hasEmail && <Bar dataKey="email" stackId="volume" fill="var(--chart-4)" radius={[3, 3, 0, 0]} isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
