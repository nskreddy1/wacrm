import "server-only"

import type { AccountContext } from "@/lib/auth/account"
import type { DashboardData } from "./mock-repository"

function compactCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return `${Math.floor(seconds / 86400)} d ago`
}

export async function getSupabaseDashboard(ctx: AccountContext): Promise<DashboardData> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const [conversations, contacts, deals, messages, members] = await Promise.all([
    ctx.supabase.from("conversations").select("id, assigned_agent_id, last_message_at, updated_at, status").eq("account_id", ctx.accountId).neq("status", "closed"),
    ctx.supabase.from("contacts").select("id, created_at", { count: "exact" }).eq("account_id", ctx.accountId).gte("created_at", since),
    ctx.supabase.from("deals").select("id, title, value, currency, status, updated_at").eq("account_id", ctx.accountId),
    ctx.supabase.from("messages").select("id, created_at, sender_type, content_text").eq("account_id", ctx.accountId).gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()).order("created_at", { ascending: false }),
    ctx.supabase.from("profiles").select("user_id, full_name").eq("account_id", ctx.accountId),
  ])

  const failed = [conversations.error, contacts.error, deals.error, messages.error, members.error].find(Boolean)
  if (failed) throw new Error(failed.message)

  const open = conversations.data ?? []
  const activeDeals = (deals.data ?? []).filter((deal) => deal.status === "open")
  const pipelineValue = activeDeals.reduce((sum, deal) => sum + Number(deal.value ?? 0), 0)
  const currency = activeDeals[0]?.currency ?? "USD"
  const memberMap = new Map((members.data ?? []).map((member) => [member.user_id, member.full_name || "Team member"]))
  const workload = Array.from(memberMap.entries()).map(([userId, name]) => ({
    name,
    open: open.filter((conversation) => conversation.assigned_agent_id === userId).length,
    status: "Active",
  })).sort((a, b) => b.open - a.open).slice(0, 5)

  const recentMessages = (messages.data ?? []).slice(0, 4).map((message) => ({
    title: message.content_text || "New conversation activity",
    time: relativeTime(message.created_at),
    type: message.sender_type === "customer" ? "Customer message" : "Message",
  }))
  const recentDeals = (deals.data ?? []).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, Math.max(0, 4 - recentMessages.length)).map((deal) => ({ title: `${deal.title} was updated`, time: relativeTime(deal.updated_at), type: "Deal" }))

  const volume = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (13 - index))
    const next = new Date(day); next.setDate(next.getDate() + 1)
    return (messages.data ?? []).filter((message) => { const at = new Date(message.created_at); return at >= day && at < next }).length
  })

  return {
    metrics: [
      { label: "Open conversations", value: String(open.length), change: "Live", detail: `${open.filter((item) => !item.assigned_agent_id).length} unassigned` },
      { label: "New contacts", value: String(contacts.count ?? 0), change: "30d", detail: "Last 30 days" },
      { label: "Pipeline value", value: compactCurrency(pipelineValue, currency), change: "Live", detail: `${activeDeals.length} active deals` },
      { label: "Messages", value: String(messages.data?.length ?? 0), change: "7d", detail: "Last 7 days" },
    ],
    workload,
    activity: [...recentMessages, ...recentDeals],
    volume,
  }
}
