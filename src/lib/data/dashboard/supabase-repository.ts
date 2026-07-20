import "server-only"

// ============================================================
// Dashboard overview repository.
//
// Single entry point: getDashboardOverview(ctx) — runs all
// account-scoped queries in parallel and assembles the
// DashboardOverview contract consumed by the dashboard UI.
// ============================================================

import type { AccountContext } from "@/lib/auth/account"
import {
  listAppointments,
  listTasks,
} from "@/lib/data/operations/supabase-repository"

import type {
  ActivityEntry,
  AttentionItem,
  BroadcastStatus,
  Channel,
  ChannelSummary,
  DashboardOverview,
  GrowthPoint,
  PipelineSummary,
  TeamMemberSummary,
  VolumePoint,
} from "./types"

const DAY_MS = 86_400_000

/** A deal is considered stalled after 14 days without movement. */
const STALLED_DEAL_THRESHOLD_MS = 14 * DAY_MS

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfDayAgo(days: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d
}

/** Percent change vs baseline; null when there is no baseline. */
function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

type ConversationRow = {
  id: string
  assigned_agent_id: string | null
  status: string
  channel: string | null
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  conversation_id: string
  created_at: string
  sender_type: string
  content_text: string | null
  conversation: { account_id: string; channel: string | null } | null
}

type DealRow = {
  id: string
  title: string
  value: number | null
  currency: string | null
  status: string
  stage_id: string | null
  updated_at: string
  closed_at: string | null
}

type StageRow = { id: string; name: string; position: number }

type BroadcastRow = {
  id: string
  name: string
  channel: string | null
  status: string
  total_recipients: number | null
  sent_count: number | null
  delivered_count: number | null
  read_count: number | null
  replied_count: number | null
  failed_count: number | null
  created_at: string
}

function conversationChannel(raw: string | null): Channel {
  return raw === "email" ? "email" : raw === "sms" ? "sms" : "whatsapp"
}

export async function getDashboardOverview(ctx: AccountContext): Promise<DashboardOverview> {
  const now = Date.now()
  const since14d = new Date(now - 14 * DAY_MS).toISOString()
  const since30d = new Date(now - 30 * DAY_MS).toISOString()
  const since60d = new Date(now - 60 * DAY_MS).toISOString()

  const [
    conversationsRes,
    contactsTotalRes,
    contactsRecentRes,
    dealsRes,
    stagesRes,
    messagesRes,
    profilesRes,
    broadcastsRes,
    appointments,
    tasks,
  ] = await Promise.all([
    ctx.supabase
      .from("conversations")
      .select("id, assigned_agent_id, status, channel, created_at, updated_at")
      .eq("account_id", ctx.accountId),
    ctx.supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId),
    ctx.supabase
      .from("contacts")
      .select("created_at")
      .eq("account_id", ctx.accountId)
      .gte("created_at", since60d),
    ctx.supabase
      .from("deals")
      .select("id, title, value, currency, status, stage_id, updated_at, closed_at")
      .eq("account_id", ctx.accountId),
    ctx.supabase.from("pipeline_stages").select("id, name, position"),
    // messages has no account_id — scope through the conversations FK
    // (inner join); RLS enforces the same boundary.
    ctx.supabase
      .from("messages")
      .select(
        "id, conversation_id, created_at, sender_type, content_text, conversation:conversations!inner(account_id, channel)",
      )
      .eq("conversation.account_id", ctx.accountId)
      .gte("created_at", since14d)
      .order("created_at", { ascending: false }),
    ctx.supabase.from("profiles").select("user_id, full_name").eq("account_id", ctx.accountId),
    ctx.supabase
      .from("broadcasts")
      .select(
        "id, name, channel, status, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count, created_at",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      .limit(25),
    listAppointments(ctx, { status: "scheduled", from: new Date(now).toISOString(), limit: 6 }),
    listTasks(ctx, { status: "open", limit: 8 }),
  ])

  const queryError = [
    conversationsRes.error,
    contactsTotalRes.error,
    contactsRecentRes.error,
    dealsRes.error,
    stagesRes.error,
    messagesRes.error,
    profilesRes.error,
    broadcastsRes.error,
  ].find(Boolean)
  if (queryError) throw new Error(queryError.message)

  const conversations = (conversationsRes.data ?? []) as ConversationRow[]
  const deals = (dealsRes.data ?? []) as DealRow[]
  const stages = (stagesRes.data ?? []) as StageRow[]
  const messages = (messagesRes.data ?? []) as unknown as MessageRow[]
  const broadcasts = (broadcastsRes.data ?? []) as BroadcastRow[]
  const contactsTotal = contactsTotalRes.count ?? 0
  const contactDates = (contactsRecentRes.data ?? []).map((row) => String(row.created_at))

  // ---- KPIs -------------------------------------------------
  const openConversations = conversations.filter((c) => c.status !== "closed")
  const unassigned = openConversations.filter((c) => !c.assigned_agent_id).length

  const cutoff7d = now - 7 * DAY_MS
  const cutoff14d = now - 14 * DAY_MS
  const newConvs7d = conversations.filter((c) => new Date(c.created_at).getTime() >= cutoff7d).length
  const newConvsPrev7d = conversations.filter((c) => {
    const at = new Date(c.created_at).getTime()
    return at >= cutoff14d && at < cutoff7d
  }).length

  const cutoff30d = now - 30 * DAY_MS
  const newContacts30d = contactDates.filter((at) => new Date(at).getTime() >= cutoff30d).length
  const newContactsPrev30d = contactDates.length - newContacts30d

  const messages7d = messages.filter((m) => new Date(m.created_at).getTime() >= cutoff7d)
  const messagesPrev7d = messages.length - messages7d.length

  const openDeals = deals.filter((d) => d.status === "open")
  const pipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0)
  const pipelineCurrency = openDeals.find((d) => d.currency)?.currency ?? "USD"

  // Response rate: of conversations with inbound in the last 7d, how
  // many also have an outbound (agent/system) message in that window.
  const inboundConvIds = new Set<string>()
  const outboundConvIds = new Set<string>()
  for (const message of messages7d) {
    if (message.sender_type === "customer") inboundConvIds.add(message.conversation_id)
    else outboundConvIds.add(message.conversation_id)
  }
  let answered = 0
  for (const id of inboundConvIds) if (outboundConvIds.has(id)) answered += 1
  const responseRatePct =
    inboundConvIds.size > 0 ? Math.round((answered / inboundConvIds.size) * 100) : null

  // ---- Channels + volume -----------------------------------
  const channelMap = new Map<Channel, ChannelSummary>()
  const ensureChannel = (channel: Channel): ChannelSummary => {
    let summary = channelMap.get(channel)
    if (!summary) {
      summary = { channel, openConversations: 0, messages7d: 0, inbound7d: 0, outbound7d: 0 }
      channelMap.set(channel, summary)
    }
    return summary
  }

  for (const conversation of openConversations) {
    ensureChannel(conversationChannel(conversation.channel)).openConversations += 1
  }
  for (const message of messages7d) {
    const summary = ensureChannel(conversationChannel(message.conversation?.channel ?? null))
    summary.messages7d += 1
    if (message.sender_type === "customer") summary.inbound7d += 1
    else summary.outbound7d += 1
  }

  const volume: VolumePoint[] = Array.from({ length: 14 }, (_, index) => {
    const dayStart = startOfDayAgo(13 - index)
    const dayEnd = new Date(dayStart.getTime() + DAY_MS)
    const point: VolumePoint = { day: isoDate(dayStart), whatsapp: 0, sms: 0, email: 0 }
    for (const message of messages) {
      const at = new Date(message.created_at)
      if (at >= dayStart && at < dayEnd) {
        point[conversationChannel(message.conversation?.channel ?? null)] += 1
      }
    }
    return point
  })

  // ---- Broadcasts ------------------------------------------
  const broadcastTotals = broadcasts.reduce(
    (totals, row) => ({
      sent: totals.sent + Number(row.sent_count ?? 0),
      delivered: totals.delivered + Number(row.delivered_count ?? 0),
      read: totals.read + Number(row.read_count ?? 0),
      replied: totals.replied + Number(row.replied_count ?? 0),
      failed: totals.failed + Number(row.failed_count ?? 0),
    }),
    { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
  )

  const recentBroadcasts = broadcasts.slice(0, 4).map((row) => ({
    id: row.id,
    name: row.name,
    channel: (row.channel === "sms" ? "sms" : "whatsapp") as Channel,
    status: (["draft", "scheduled", "sending", "sent", "failed"].includes(row.status)
      ? row.status
      : "draft") as BroadcastStatus,
    totalRecipients: Number(row.total_recipients ?? 0),
    sent: Number(row.sent_count ?? 0),
    delivered: Number(row.delivered_count ?? 0),
    read: Number(row.read_count ?? 0),
    failed: Number(row.failed_count ?? 0),
    createdAt: row.created_at,
  }))

  // ---- Pipeline --------------------------------------------
  const stageOrder = new Map(stages.map((stage) => [stage.id, stage]))
  const stageAggregates = new Map<string, { count: number; value: number }>()
  for (const deal of openDeals) {
    if (!deal.stage_id) continue
    const aggregate = stageAggregates.get(deal.stage_id) ?? { count: 0, value: 0 }
    aggregate.count += 1
    aggregate.value += Number(deal.value ?? 0)
    stageAggregates.set(deal.stage_id, aggregate)
  }

  const pipelineStages = Array.from(stageAggregates.entries())
    .map(([stageId, aggregate]) => ({
      id: stageId,
      name: stageOrder.get(stageId)?.name ?? "Stage",
      position: stageOrder.get(stageId)?.position ?? 999,
      count: aggregate.count,
      value: aggregate.value,
    }))
    .sort((a, b) => a.position - b.position)
    .map(({ position: _position, ...stage }) => stage)

  const closed30d = deals.filter(
    (deal) => deal.closed_at && new Date(deal.closed_at).getTime() >= cutoff30d,
  )
  const won30d = closed30d.filter((deal) => deal.status === "won")
  const pipeline: PipelineSummary = {
    stages: pipelineStages,
    wonValue30d: won30d.reduce((sum, deal) => sum + Number(deal.value ?? 0), 0),
    wonCount30d: won30d.length,
    lostCount30d: closed30d.filter((deal) => deal.status === "lost").length,
  }

  // ---- Team -------------------------------------------------
  const team: TeamMemberSummary[] = (profilesRes.data ?? [])
    .map((profile) => ({
      userId: String(profile.user_id),
      name: (profile.full_name as string | null) || "Team member",
      open: openConversations.filter((c) => c.assigned_agent_id === profile.user_id).length,
      resolved7d: conversations.filter(
        (c) =>
          c.status === "closed" &&
          c.assigned_agent_id === profile.user_id &&
          new Date(c.updated_at).getTime() >= cutoff7d,
      ).length,
    }))
    .sort((a, b) => b.open - a.open || b.resolved7d - a.resolved7d)
    .slice(0, 5)

  // ---- Contacts growth (30d) -------------------------------
  const added30d = contactDates.filter((at) => new Date(at).getTime() >= cutoff30d)
  let runningTotal = contactsTotal - added30d.length
  const contactsGrowth: GrowthPoint[] = Array.from({ length: 30 }, (_, index) => {
    const dayStart = startOfDayAgo(29 - index)
    const dayEnd = new Date(dayStart.getTime() + DAY_MS)
    const added = added30d.filter((at) => {
      const time = new Date(at).getTime()
      return time >= dayStart.getTime() && time < dayEnd.getTime()
    }).length
    runningTotal += added
    return { day: isoDate(dayStart), total: runningTotal, added }
  })

  // ---- Activity feed ---------------------------------------
  const activity: ActivityEntry[] = [
    ...messages.slice(0, 4).map((message) => ({
      id: `msg-${message.id}`,
      title: message.content_text?.slice(0, 90) || "New conversation activity",
      time: relativeTime(message.created_at),
      type: "message" as const,
      href: "/inbox",
    })),
    ...deals
      .slice()
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 3)
      .map((deal) => ({
        id: `deal-${deal.id}`,
        title:
          deal.status === "won"
            ? `Deal "${deal.title}" was won`
            : deal.status === "lost"
              ? `Deal "${deal.title}" was lost`
              : `Deal "${deal.title}" was updated`,
        time: relativeTime(deal.updated_at),
        type: "deal" as const,
        href: "/pipeline",
      })),
    ...broadcasts.slice(0, 2).map((row) => ({
      id: `bc-${row.id}`,
      title: `Broadcast "${row.name}" ${row.status === "sending" ? "is sending" : `is ${row.status}`}`,
      time: relativeTime(row.created_at),
      type: "broadcast" as const,
      href: "/broadcasts",
    })),
  ].slice(0, 9)

  // ---- Needs attention -------------------------------------
  const overdueTasks = tasks.filter(
    (task) => task.dueAt && new Date(task.dueAt).getTime() < now,
  ).length
  const failedBroadcasts7d = broadcasts.filter(
    (row) =>
      new Date(row.created_at).getTime() >= cutoff7d &&
      (row.status === "failed" || Number(row.failed_count ?? 0) > 0),
  ).length
  const stalledDeals = openDeals.filter(
    (deal) => now - new Date(deal.updated_at).getTime() > STALLED_DEAL_THRESHOLD_MS,
  ).length

  const attention: AttentionItem[] = [
    { key: "unassigned", label: "Unassigned conversations", count: unassigned, href: "/inbox" },
    { key: "overdue_tasks", label: "Overdue tasks", count: overdueTasks, href: "/dashboard" },
    { key: "failed_broadcasts", label: "Broadcasts with failures (7d)", count: failedBroadcasts7d, href: "/broadcasts" },
    { key: "stalled_deals", label: "Deals stalled 14+ days", count: stalledDeals, href: "/pipeline" },
  ]

  return {
    kpis: {
      openConversations: openConversations.length,
      openConversationsDelta: percentDelta(newConvs7d, newConvsPrev7d),
      unassigned,
      newContacts30d,
      newContactsDelta: percentDelta(newContacts30d, newContactsPrev30d),
      pipelineValue,
      pipelineCurrency,
      activeDeals: openDeals.length,
      messages7d: messages7d.length,
      messagesDelta: percentDelta(messages7d.length, messagesPrev7d),
      responseRatePct,
    },
    channels: Array.from(channelMap.values()).sort((a, b) => b.messages7d - a.messages7d),
    volume,
    broadcasts: { totals: broadcastTotals, recent: recentBroadcasts },
    pipeline,
    team,
    contactsGrowth,
    activity,
    appointments: appointments.map((appointment) => ({
      id: appointment.id,
      contact: appointment.contactName ?? "Contact",
      service: appointment.catalogItemName ?? appointment.title,
      startsAt: appointment.startsAt,
      location: appointment.location,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      priority: task.priority,
      contact: task.contactName,
      overdue: Boolean(task.dueAt && new Date(task.dueAt).getTime() < now),
    })),
    attention,
  }
}
