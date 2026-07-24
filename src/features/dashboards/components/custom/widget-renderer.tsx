"use client"

// ============================================================
// Renders ONE DashboardWidget from the shared overview payload.
// Widgets are pure projections of /api/v1/dashboard data — no
// widget makes its own network requests (TasksPanel/Appointments
// mutate via their own actions and call refresh()).
// ============================================================

import type { ComponentType } from "react"
import {
  Briefcase,
  CircleCheckBig,
  MessageSquareText,
  Radio,
  Target,
  TrendingDown,
  UserPlus,
  Users,
} from "lucide-react"

import type { DashboardOverview } from "@/lib/data/dashboard/types"
import {
  KPI_METRICS,
  TARGET_METRICS,
  widgetTitle,
  type DashboardWidget,
  type KpiMetric,
  type TargetMetric,
} from "@/features/dashboards/lib/widgets"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { ChannelBadge, channelColorVar } from "@/components/ui/channel-badge"
import { ActivityFeed } from "../activity-feed"
import { BroadcastFunnel } from "../broadcast-funnel"
import { ChartCard } from "../chart-card"
import { ContactsGrowth } from "../contacts-growth"
import { KpiCard } from "../kpi-card"
import { PipelineFunnel } from "../pipeline-funnel"
import { TasksPanel } from "../tasks-panel"
import { TeamPerformance } from "../team-performance"
import { UpcomingAppointments } from "../upcoming-appointments"
import { VolumeChart } from "../volume-chart"

// ------------------------------------------------------------
// Metric value extraction (shared by KPI + Target widgets).
// ------------------------------------------------------------

function metricValue(overview: DashboardOverview, metric: KpiMetric | TargetMetric): number {
  const { kpis, pipeline } = overview
  switch (metric) {
    case "openConversations":
      return kpis.openConversations
    case "unassigned":
      return kpis.unassigned
    case "newContacts30d":
      return kpis.newContacts30d
    case "pipelineValue":
      return kpis.pipelineValue
    case "activeDeals":
      return kpis.activeDeals
    case "messages7d":
      return kpis.messages7d
    case "responseRatePct":
      return kpis.responseRatePct ?? 0
    case "wonValue30d":
      return pipeline.wonValue30d
    case "wonCount30d":
      return pipeline.wonCount30d
    case "lostCount30d":
      return pipeline.lostCount30d
  }
}

function metricDelta(overview: DashboardOverview, metric: KpiMetric): number | null {
  const { kpis } = overview
  switch (metric) {
    case "openConversations":
      return kpis.openConversationsDelta
    case "newContacts30d":
      return kpis.newContactsDelta
    case "messages7d":
      return kpis.messagesDelta
    default:
      return null
  }
}

const METRIC_ICONS: Record<KpiMetric, ComponentType<{ className?: string }>> = {
  openConversations: MessageSquareText,
  unassigned: MessageSquareText,
  newContacts30d: UserPlus,
  pipelineValue: Briefcase,
  activeDeals: Briefcase,
  messages7d: Radio,
  responseRatePct: Users,
  wonValue30d: CircleCheckBig,
  wonCount30d: CircleCheckBig,
  lostCount30d: TrendingDown,
}

const METRIC_HREFS: Record<KpiMetric, string> = {
  openConversations: "/inbox",
  unassigned: "/inbox",
  newContacts30d: "/contacts",
  pipelineValue: "/pipeline",
  activeDeals: "/pipeline",
  messages7d: "/inbox",
  responseRatePct: "/inbox",
  wonValue30d: "/pipeline",
  wonCount30d: "/pipeline",
  lostCount30d: "/pipeline",
}

// ------------------------------------------------------------
// Target meter — semicircle SVG gauge (no extra chart lib).
// ------------------------------------------------------------

function TargetMeter({
  title,
  value,
  goal,
  format,
  currency,
}: {
  title: string
  value: number
  goal: number
  format: "number" | "currency" | "percent"
  currency: string
}) {
  const pct = Math.max(0, Math.min(1, goal > 0 ? value / goal : 0))
  // Semicircle arc: radius 80, center (100, 95), sweep left → right.
  const r = 80
  const circumference = Math.PI * r
  const dash = pct * circumference

  const fmt = (n: number) =>
    format === "currency"
      ? new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n)
      : format === "percent"
        ? `${Math.round(n)}%`
        : new Intl.NumberFormat("en").format(n)

  const reached = pct >= 1

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-(--shadow-pipeline-card)">
      <div className="flex items-center justify-between gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Target className="size-4" aria-hidden="true" />
        </div>
        {reached && (
          <span className="rounded-full bg-positive/10 px-1.5 py-0.5 text-[11px] font-semibold text-positive">
            Goal reached
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-1 flex-col items-center justify-center">
        <svg viewBox="0 0 200 105" className="w-full max-w-[190px]" role="img" aria-label={`${title}: ${fmt(value)} of ${fmt(goal)} goal`}>
          <path
            d={`M 20 95 A ${r} ${r} 0 0 1 180 95`}
            fill="none"
            stroke="var(--color-muted)"
            strokeWidth="13"
            strokeLinecap="round"
          />
          <path
            d={`M 20 95 A ${r} ${r} 0 0 1 180 95`}
            fill="none"
            stroke={reached ? "var(--color-positive, var(--color-primary))" : "var(--color-primary)"}
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className="transition-[stroke-dasharray] duration-700 ease-out"
          />
          <text x="100" y="78" textAnchor="middle" className="fill-foreground text-[26px] font-semibold tabular-nums">
            {Math.round(pct * 100)}%
          </text>
        </svg>
        <p className="text-[13px] font-medium text-foreground/90">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {fmt(value)} of {fmt(goal)} goal
        </p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Channel share — compact bars, reused look from the overview.
// ------------------------------------------------------------

function ChannelShare({ overview }: { overview: DashboardOverview }) {
  const { channels } = overview
  if (channels.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No channel activity in the last 7 days.</p>
  }
  const total = channels.reduce((sum, c) => sum + c.messages7d, 0) || 1
  return (
    <div className="flex flex-col gap-3">
      {channels.map((ch) => {
        const share = Math.round((ch.messages7d / total) * 100)
        return (
          <div key={ch.channel} className="flex flex-col gap-2 rounded-lg border border-border bg-card-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <ChannelBadge channel={ch.channel} />
              <span className="text-xs text-muted-foreground tabular-nums">
                <AnimatedNumber value={ch.messages7d} /> msgs · {share}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${share}%`, background: channelColorVar(ch.channel) }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------
// Main renderer.
// ------------------------------------------------------------

export function WidgetRenderer({
  widget,
  overview,
  refresh,
}: {
  widget: DashboardWidget
  overview: DashboardOverview
  refresh: () => void
}) {
  const title = widgetTitle(widget)
  const currency = overview.kpis.pipelineCurrency
  const money: Intl.NumberFormatOptions = { style: "currency", currency, maximumFractionDigits: 0 }

  switch (widget.type) {
    case "kpi": {
      const metric = widget.config.metric as KpiMetric
      const meta = KPI_METRICS[metric]
      return (
        <KpiCard
          label={title}
          value={metricValue(overview, metric)}
          format={meta.format === "currency" ? money : undefined}
          suffix={meta.format === "percent" ? "%" : undefined}
          delta={meta.hasDelta ? metricDelta(overview, metric) : null}
          detail={meta.description}
          icon={METRIC_ICONS[metric]}
          href={METRIC_HREFS[metric]}
        />
      )
    }

    case "target": {
      const metric = widget.config.metric as TargetMetric
      const meta = TARGET_METRICS[metric]
      return (
        <TargetMeter
          title={title}
          value={metricValue(overview, metric)}
          goal={widget.config.goal ?? 1}
          format={meta.format}
          currency={currency}
        />
      )
    }

    case "chart": {
      switch (widget.config.kind) {
        case "volume":
          return (
            <ChartCard title={title} caption="Daily inbound + outbound messages by channel" className="h-full">
              <VolumeChart data={overview.volume} />
            </ChartCard>
          )
        case "growth":
          return (
            <ChartCard title={title} caption="Total contact base over time" href="/contacts" className="h-full">
              <ContactsGrowth data={overview.contactsGrowth} />
            </ChartCard>
          )
        case "pipeline":
          return (
            <ChartCard title={title} caption="Active deals by stage" href="/pipeline" className="h-full">
              <PipelineFunnel
                stages={overview.pipeline.stages}
                wonValue30d={overview.pipeline.wonValue30d}
                wonCount30d={overview.pipeline.wonCount30d}
                lostCount30d={overview.pipeline.lostCount30d}
                currency={currency}
              />
            </ChartCard>
          )
        case "channelShare":
          return (
            <ChartCard title={title} caption="Message share by channel, last 7 days" className="h-full">
              <ChannelShare overview={overview} />
            </ChartCard>
          )
        case "broadcast":
          return (
            <ChartCard title={title} caption="Delivery funnel across your latest campaigns" href="/broadcasts" className="h-full">
              <BroadcastFunnel totals={overview.broadcasts.totals} recent={overview.broadcasts.recent} />
            </ChartCard>
          )
        default:
          return null
      }
    }

    case "panel": {
      switch (widget.config.panel) {
        case "tasks":
          return <TasksPanel tasks={overview.tasks} onChanged={refresh} />
        case "appointments":
          return <UpcomingAppointments appointments={overview.appointments} onChanged={refresh} />
        case "activity":
          return <ActivityFeed items={overview.activity} />
        case "team":
          return (
            <ChartCard title={title} caption="Open vs resolved conversations per agent" className="h-full">
              {overview.team.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No assigned conversations yet.</p>
              ) : (
                <TeamPerformance team={overview.team} />
              )}
            </ChartCard>
          )
        case "broadcasts":
          return (
            <ChartCard title={title} caption="Latest campaigns with delivery stats" href="/broadcasts" className="h-full">
              <BroadcastFunnel totals={overview.broadcasts.totals} recent={overview.broadcasts.recent} />
            </ChartCard>
          )
        default:
          return null
      }
    }

    default:
      return null
  }
}
