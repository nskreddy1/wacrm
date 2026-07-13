"use client"

import { usePathname, useRouter } from "next/navigation"
import { Bell, ChevronDown, Command, Menu, Plus, Search, Settings, UserPlus } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { routes } from "@/lib/routing/routes"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const titles: Record<string, string> = {
  dashboard: "Dashboard",
  inbox: "Shared inbox",
  contacts: "Contacts",
  pipelines: "Pipelines",
  bookings: "Bookings",
  broadcasts: "Broadcasts",
  automations: "Automations",
  flows: "Flows",
  agents: "AI agents",
  notifications: "Notifications",
  settings: "Settings",
}

export function Header({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const segment = pathname.split("/").filter(Boolean)[0] ?? "dashboard"
  const title = titles[segment] ?? "Workspace"

  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3 lg:px-4">
      <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="Open navigation" className="md:hidden"><Menu /></Button>
      <div className="hidden min-w-32 sm:block"><p className="text-[10px] text-muted-foreground">Acme Support</p><h1 className="truncate text-sm font-semibold">{title}</h1></div>
      <Button variant="outline" className="min-w-0 flex-1 justify-start text-muted-foreground sm:max-w-md" aria-label="Search workspace">
        <Search data-icon="inline-start" />
        <span className="truncate">Search contacts, messages and deals</span>
        <span className="ml-auto hidden items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] md:flex"><Command />K</span>
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="hidden sm:flex"><Plus data-icon="inline-start" />Create<ChevronDown data-icon="inline-end" /></Button>} />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Create new</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push(routes.app.contacts)}><UserPlus />Contact</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(routes.app.pipelines)}><Plus />Deal</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(routes.app.bookings)}><Plus />Booking</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Notifications" className="relative"><Bell /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" /></Button>} />
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup><DropdownMenuItem onClick={() => router.push(routes.app.inbox)}>3 conversations need assignment</DropdownMenuItem><DropdownMenuItem onClick={() => router.push(routes.app.pipelines)}>Northstar deal moved to proposal</DropdownMenuItem></DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Open account menu"><Avatar size="sm"><AvatarFallback className="bg-secondary font-semibold text-secondary-foreground">SS</AvatarFallback></Avatar></Button>} />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Sam Silva<span className="block font-normal text-muted-foreground">Workspace owner</span></DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup><DropdownMenuItem onClick={() => router.push(routes.app.settings)}><Settings />Settings</DropdownMenuItem></DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
