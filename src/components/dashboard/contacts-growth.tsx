"use client"

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartTooltipContent } from "@/components/ui/chart"

type ContactsGrowthProps = {
  data: Array<{ day: string; total: number; added: number }>
}

const dayFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

/** 30-day cumulative contact base growth (area with gradient fill). */
export function ContactsGrowth({ data }: ContactsGrowthProps) {
  const chartData = data.map((d) => ({ ...d, label: dayFormatter.format(new Date(`${d.day}T00:00:00`)) }))
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="contacts-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            domain={["dataMin - 20", "dataMax + 20"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            isAnimationActive={false}
            content={<ChartTooltipContent labels={{ total: "Total contacts", added: "Added" }} />}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#contacts-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
