"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartLegend, ChartTooltipContent } from "@/components/ui/chart"
import { channelColorVar } from "@/components/ui/channel-badge"

type VolumeChartProps = {
  data: Array<{ day: string; whatsapp: number; sms: number }>
}

const dayFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

/** 14-day message volume, stacked by channel (WhatsApp vs SMS). */
export function VolumeChart({ data }: VolumeChartProps) {
  const chartData = data.map((d) => ({ ...d, label: dayFormatter.format(new Date(`${d.day}T00:00:00`)) }))
  return (
    <div className="flex h-full flex-col gap-3">
      <ChartLegend
        items={[
          { label: "WhatsApp", color: channelColorVar("whatsapp") },
          { label: "SMS", color: channelColorVar("sms") },
        ]}
      />
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
              content={<ChartTooltipContent labels={{ whatsapp: "WhatsApp", sms: "SMS" }} />}
            />
            <Bar dataKey="whatsapp" stackId="volume" fill={channelColorVar("whatsapp")} isAnimationActive={false} />
            <Bar dataKey="sms" stackId="volume" fill={channelColorVar("sms")} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
