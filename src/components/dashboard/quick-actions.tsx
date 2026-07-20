"use client"

import Link from "next/link"
import type { ComponentType } from "react"
import { CalendarPlus, MessageSquarePlus, Send, UserPlus } from "lucide-react"

const ACTIONS: Array<{
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
}> = [
  { label: "New broadcast", href: "/broadcasts/new", icon: Send },
  { label: "Add contact", href: "/contacts", icon: UserPlus },
  { label: "Start chat", href: "/inbox", icon: MessageSquarePlus },
  { label: "New booking", href: "/bookings", icon: CalendarPlus },
]

/** Compact 2x2 quick-action launcher for the dashboard right rail. */
export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2">
      {ACTIONS.map(({ label, href, icon: Icon }) => (
        <Link
          key={label}
          href={href}
          className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-3 shadow-(--shadow-pipeline-card) transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 motion-reduce:hover:translate-y-0"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary-soft text-primary transition-transform duration-200 group-hover:scale-110 motion-reduce:group-hover:scale-100">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold">{label}</span>
        </Link>
      ))}
    </nav>
  )
}
