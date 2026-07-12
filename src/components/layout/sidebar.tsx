"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect } from "react"
import { BarChart3, Bot, CalendarDays, GitBranch, LayoutDashboard, Megaphone, MessageSquareText, Settings, Users, Workflow, X } from "lucide-react"
import { cn } from "@/lib/utils"

const items = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: MessageSquareText, badge: "18" },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/agents", label: "AI agents", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname()
  useEffect(() => onClose?.(), [pathname])

  return <>
    <button aria-label="Close navigation" onClick={onClose} className={cn("fixed inset-0 z-30 bg-foreground/30 lg:hidden", open ? "block" : "hidden")} />
    <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-[#073b4c] text-[#f7fbfa] transition-transform lg:static lg:w-[76px] lg:translate-x-0 xl:w-60", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-14 items-center gap-3 border-b border-[#f7fbfa]/10 px-4 lg:justify-center xl:justify-start">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#22c983] text-[#073b4c]"><MessageSquareText className="size-4" /></div>
        <div className="min-w-0 lg:hidden xl:block"><p className="text-sm font-semibold">Relay CRM</p><p className="truncate text-[11px] text-[#f7fbfa]/55">Acme Support</p></div>
        <button onClick={onClose} aria-label="Close menu" className="ml-auto lg:hidden"><X className="size-5" /></button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label="Primary navigation">
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} title={item.label} className={cn("group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#f7fbfa]/68 transition-colors hover:bg-[#f7fbfa]/8 hover:text-[#f7fbfa] lg:justify-center xl:justify-start", active && "bg-[#22c983] text-[#073b4c] hover:bg-[#22c983] hover:text-[#073b4c]")}>
            <item.icon className="size-[18px] shrink-0" /><span className="lg:hidden xl:block">{item.label}</span>{item.badge && <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] lg:hidden xl:block", active ? "bg-[#073b4c]/15" : "bg-[#f7fbfa]/10")}>{item.badge}</span>}
          </Link>
        })}
      </nav>
      <div className="border-t border-[#f7fbfa]/10 p-3 lg:flex lg:justify-center xl:block">
        <div className="flex items-center gap-3"><div className="flex size-8 items-center justify-center rounded-full bg-[#d9f7e9] text-xs font-bold text-[#073b4c]">SS</div><div className="min-w-0 lg:hidden xl:block"><p className="truncate text-xs font-semibold">Sam Silva</p><p className="text-[10px] text-[#f7fbfa]/50">Workspace owner</p></div></div>
      </div>
    </aside>
  </>
}
