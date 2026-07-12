"use client"

import { usePathname } from "next/navigation"
import { Bell, ChevronDown, Command, Menu, Plus, Search } from "lucide-react"

const titles: Record<string, string> = { dashboard: "Overview", inbox: "Shared inbox", contacts: "Contacts", pipelines: "Sales pipeline", bookings: "Bookings", broadcasts: "Broadcasts", automations: "Automations", settings: "Settings" }

export function Header({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const pathname = usePathname()
  const segment = pathname.split("/").filter(Boolean)[0] ?? "dashboard"
  return <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3 lg:px-5">
    <button onClick={onOpenSidebar} aria-label="Open navigation" className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"><Menu className="size-5" /></button>
    <div className="hidden min-w-36 sm:block"><p className="text-xs text-muted-foreground">Acme Support</p><h1 className="text-sm font-semibold">{titles[segment] ?? "Workspace"}</h1></div>
    <button className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm text-muted-foreground sm:max-w-md" aria-label="Search workspace"><Search className="size-4" /><span className="truncate">Search contacts, messages and deals</span><span className="ml-auto hidden items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] md:flex"><Command className="size-3" /> K</span></button>
    <div className="ml-auto flex items-center gap-1">
      <button className="hidden h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground sm:flex"><Plus className="size-4" /> Create <ChevronDown className="size-3" /></button>
      <button aria-label="Notifications" className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><Bell className="size-[18px]" /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" /></button>
      <button aria-label="Open account menu" className="flex size-9 items-center justify-center rounded-full bg-[#d9f7e9] text-xs font-bold text-[#073b4c]">SS</button>
    </div>
  </header>
}
