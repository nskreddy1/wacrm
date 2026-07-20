"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Briefcase,
  MessageSquareText,
  Plus,
  Radio,
  RotateCw,
  Send,
  UserPlus,
  Users,
} from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { useDashboardOverview } from "@/hooks/use-dashboard-overview"
import { personDisplayName, workspaceDisplayName } from "@/lib/display-name"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { Button } from "@/components/ui/button"
import { ChannelBadge, channelColorVar } from "@/components/ui/channel-badge"
import { ActivityFeed } from "./activity-feed"
import { AttentionPanel } from "./attention-panel"
import { BroadcastFunnel } from "./broadcast-funnel"
import { ChartCard, CardMetaChip } from "./chart-card"
import { ContactsGrowth } from "./contacts-growth"
import { KpiCard } from "./kpi-card"
import { PipelineFunnel } from "./pipeline-funnel"
import { Section } from "./section"
import { Skeleton, SkeletonCard } from "./skeleton"
import { TasksPanel } from "./tasks-panel"
import { TeamPerformance } from "./team-performance"
import { UpcomingAppointments } from "./upcoming-appointments"
import { VolumeChart } from "./volume-chart"

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

/**
 * Time-of-day values must be computed after mount: the server clock
 * (UTC) can disagree with the visitor's local clock, which caused a
 * hydration mismatch ("Good morning" vs "Good afternoon"). SSR renders
 * the neutral fallbacks, then the client swaps in local values.
 */
function useLocalClock() {
  const [clock, setClock] = useState<{ greeting: string; today: string } | null>(null)
  useEffect(() => {
    const now = new Date()
    setClock({
      greeting: greetingForHour(now.getHours()),
      today: new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(now),
    })
  }, [])
  return clock
}

/** Full-page placeholder mirroring the real layout, shown during first load. */
function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5 p-4 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading dashboard">
      <div>
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-2 h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

/**
 * Live CRM command center — real data from /api/v1/dashboard (SWR,
 * 60s refresh). Layout follows the summary → diagnosis → action
 * hierarchy: KPI row, analytics column, right operations rail.
 */
export function DashboardWorkspace() {
  const { profile, account } = useAuth()
  const { overview, error, isLoading, refresh } = useDashboardOverview()

  const firstName = personDisplayName(profile?.full_name, profile?.email).split(/\s+/)[0] || "there"
  const workspaceName = workspaceDisplayName(account?.name)
  const clock = useLocalClock()
  const greeting = clock?.greeting ?? "Welcome back"
  const today = clock?.today ?? "Overview"

  if (isLoading && !overview) {
    return (
      <div className="app-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain">
        <DashboardSkeleton />
      </div>
    )
  }

  if (error && !overview) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-medium">The dashboard could not load.</p>
          <p className="max-w-sm text-xs text-muted-foreground text-pretty">
            Check your connection and try again. If the problem persists, your session may have expired.
          </p>
          <Button variant="outline" size="sm" onClick={() => refresh()} className="gap-1.5">
            <RotateCw className="size-3.5" aria-hidden="true" /> Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!overview) return null

  const { kpis, channels, volume, broadcasts, pipeline, team, contactsGrowth, activity, appointments, tasks, attention } = overview
  const money: Intl.NumberFormatOptions = { style: "currency", currency: kpis.pipelineCurrency, maximumFractionDigits: 0 }

  return (
    // The dashboard shell's <main> is overflow-hidden, so this page owns
    // its own scroll region — with the themed .app-scrollbar UI.
    <div className="app-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <Section index={0} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{today}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{`${greeting}, ${firstName}`}</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">{`Here is how ${workspaceName} is performing right now.`}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-positive motion-safe:animate-pulse" aria-hidden="true" />
            Live
          </span>
          <Link
            href="/contacts"
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Plus className="size-4" aria-hidden="true" /> Add contact
          </Link>
          <Link
            href="/broadcasts/new"
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Send className="size-4" aria-hidden="true" /> New broadcast
          </Link>
        </div>
      </Section>

      {/* KPI row */}
      <Section index={1} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Open conversations"
          value={kpis.openConversations}
          delta={kpis.openConversationsDelta}
          detail={`${kpis.unassigned} unassigned`}
          icon={MessageSquareText}
          href="/inbox"
        />
        <KpiCard
          label="Messages (7d)"
          value={kpis.messages7d}
          delta={kpis.messagesDelta}
          detail="Inbound + outbound"
          icon={Radio}
          href="/inbox"
        />
        <KpiCard
          label="New contacts (30d)"
          value={kpis.newContacts30d}
          delta={kpis.newContactsDelta}
          detail="Across all sources"
          icon={UserPlus}
          href="/contacts"
        />
        <KpiCard
          label="Pipeline value"
          value={kpis.pipelineValue}
          format={money}
          detail={`${kpis.activeDeals} active deals`}
          icon={Briefcase}
          href="/pipeline"
        />
        <KpiCard
          label="Response rate"
          value={kpis.responseRatePct ?? 0}
          suffix="%"
          detail="Conversations answered · 7d"
          icon={Users}
          href="/inbox"
        />
      </Section>

      {/* Body: main analytics column + sticky right rail */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
      {/* Volume + channel split */}
      <Section index={2} className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <ChartCard
          title="Message volume"
          caption="Daily inbound + outbound messages by channel"
          meta={<CardMetaChip>Last 14 days</CardMetaChip>}
        >
          <VolumeChart data={volume} />
        </ChartCard>
        <ChartCard title="Channel performance" caption="Message share by channel, last 7 days" contentClassName="flex flex-col gap-4">
          {channels.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">No channel activity in the last 7 days.</p>
          )}
          {channels.map((ch) => {
            const total = channels.reduce((sum, c) => sum + c.messages7d, 0) || 1
            const share = Math.round((ch.messages7d / total) * 100)
            return (
              <div key={ch.channel} className="flex flex-col gap-2.5 rounded-lg border border-border bg-card-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <ChannelBadge channel={ch.channel} />
                  <span className="text-xs text-muted-foreground tabular-nums">{share}% of volume</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${share}%`, background: channelColorVar(ch.channel) }} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["Messages", ch.messages7d],
                      ["Inbound", ch.inbound7d],
                      ["Open chats", ch.openConversations],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 text-sm font-semibold">
                        <AnimatedNumber value={value} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}
        </ChartCard>
      </Section>

      {/* Broadcasts + pipeline */}
      <Section index={3} className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <ChartCard
          title="Broadcast performance"
          caption="Delivery funnel across your latest campaigns"
          href="/broadcasts"
          meta={<CardMetaChip>Last 5 campaigns</CardMetaChip>}
        >
          <BroadcastFunnel totals={broadcasts.totals} recent={broadcasts.recent} />
        </ChartCard>
        <ChartCard title="Sales pipeline" caption="Active deals by stage" href="/pipeline">
          <PipelineFunnel
            stages={pipeline.stages}
            wonValue30d={pipeline.wonValue30d}
            wonCount30d={pipeline.wonCount30d}
            lostCount30d={pipeline.lostCount30d}
            currency={kpis.pipelineCurrency}
          />
        </ChartCard>
      </Section>

      {/* Team + contacts growth */}
      <Section index={4} className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <ChartCard title="Team performance" caption="Open vs resolved conversations per agent" href="/settings" hrefLabel="Manage">
          {team.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No assigned conversations yet.</p>
          ) : (
            <TeamPerformance team={team} />
          )}
        </ChartCard>
        <ChartCard title="Contacts growth" caption="Total contact base over time" meta={<CardMetaChip>Last 30 days</CardMetaChip>} href="/contacts">
          <ContactsGrowth data={contactsGrowth} />
        </ChartCard>
      </Section>
        </div>

        {/* Right rail: action layer first, then schedule, tasks, activity */}
        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-0" aria-label="Dashboard operations">
          <Section index={2}>
            <AttentionPanel items={attention} />
          </Section>
          <Section index={3}>
            <UpcomingAppointments appointments={appointments} onChanged={() => refresh()} />
          </Section>
          <Section index={4}>
            <TasksPanel tasks={tasks} onChanged={() => refresh()} />
          </Section>
          <Section index={5}>
            <ActivityFeed items={activity} />
          </Section>
        </aside>
      </div>
      </div>
    </div>
  )
}
