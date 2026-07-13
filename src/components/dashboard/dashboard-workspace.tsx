"use client"

import Link from "next/link"
import useSWR from "swr"
import { ArrowUpRight, CalendarPlus, ChevronRight, Circle, GitBranch, MessageSquareText, Plus, Send, Users } from "lucide-react"
import type { DashboardData } from "@/lib/data/dashboard/mock-repository"

type DashboardResponse = { data: DashboardData; meta: { source: "mock" | "supabase" } }

export function DashboardWorkspace() {
  const { data, error, isLoading } = useSWR<DashboardResponse>("/api/v1/dashboard")
  const dashboardData = data?.data
  const icons = [MessageSquareText, Users, GitBranch, Send]

  if (error) return <div className="flex min-h-96 items-center justify-center text-sm text-destructive">Unable to load dashboard data.</div>
  if (isLoading || !dashboardData) return <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground">Loading dashboard…</div>

  return <div className="mx-auto flex max-w-[1500px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Monday, July 12</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-balance">Good morning, Sam</h2><p className="mt-1 text-sm text-muted-foreground">Here is what needs your attention across Acme Support.</p></div>
      <div className="flex gap-2"><Link href="/contacts" className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium"><Plus className="size-4" /> Add contact</Link><Link href="/inbox" className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"><MessageSquareText className="size-4" /> Open inbox</Link></div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {dashboardData.metrics.map((metric, index) => { const Icon = icons[index]; return <article key={metric.label} className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="flex items-start justify-between"><div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-[18px]" /></div><span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">{metric.change}</span></div><p className="mt-5 text-2xl font-semibold tracking-tight">{metric.value}</p><p className="mt-1 text-sm font-medium">{metric.label}</p><p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p></article> })}
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <article className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border p-4"><div><h3 className="text-sm font-semibold">Conversation volume</h3><p className="text-xs text-muted-foreground">Messages received and resolved over 7 days</p></div><button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium">Last 7 days</button></div><div className="p-4"><div className="flex h-52 items-end gap-3 border-b border-border px-2">{[42,58,48,74,62,86,70,92,78,108,94,118,102,126].map((height, i) => <div key={i} className="flex h-full flex-1 items-end"><div className="w-full rounded-t bg-primary/20" style={{height: `${height}px`}}><div className="h-1.5 w-full rounded-t bg-primary" /></div></div>)}</div><div className="mt-3 flex justify-between text-[10px] text-muted-foreground"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div></article>
      <article className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border p-4"><div><h3 className="text-sm font-semibold">Team workload</h3><p className="text-xs text-muted-foreground">Open assigned conversations</p></div><Link href="/settings" className="text-xs font-semibold text-primary">Manage</Link></div><div className="flex flex-col p-2">{dashboardData.workload.map((member, i) => <div key={member.name} className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted"><div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-bold">{member.name.split(" ").map(n=>n[0]).join("")}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{member.name}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Circle className={`size-2 fill-current ${i < 2 ? "text-primary" : "text-amber-500"}`} /> {member.status}</p></div><div className="text-right"><p className="text-sm font-semibold">{member.open}</p><p className="text-[10px] text-muted-foreground">open</p></div></div>)}</div></article>
    </section>

    <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <article className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border p-4"><h3 className="text-sm font-semibold">Recent activity</h3><button className="text-xs font-semibold text-primary">View all</button></div><div className="divide-y divide-border">{dashboardData.activity.map(item => <div key={item.title} className="flex items-center gap-3 p-4"><div className="size-2 rounded-full bg-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.type} · {item.time}</p></div><ChevronRight className="size-4 text-muted-foreground" /></div>)}</div></article>
      <article className="rounded-xl bg-[#073b4c] p-5 text-[#f7fbfa] shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-[#22c983]">Quick actions</p><h3 className="mt-2 text-lg font-semibold">Keep work moving</h3><div className="mt-5 grid gap-2"><Link href="/broadcasts/new" className="flex items-center gap-3 rounded-lg bg-[#f7fbfa]/8 p-3 text-sm font-medium hover:bg-[#f7fbfa]/12"><Send className="size-4 text-[#22c983]" /> Create broadcast <ArrowUpRight className="ml-auto size-4" /></Link><Link href="/bookings" className="flex items-center gap-3 rounded-lg bg-[#f7fbfa]/8 p-3 text-sm font-medium hover:bg-[#f7fbfa]/12"><CalendarPlus className="size-4 text-[#22c983]" /> Manage bookings <ArrowUpRight className="ml-auto size-4" /></Link></div></article>
    </section>
  </div>
}
