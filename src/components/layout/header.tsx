"use client"

import { usePathname, useRouter } from "next/navigation"
import useSWR from "swr"
import { Bell, ChevronDown, Command, LogOut, Menu, Plus, Search, Settings, UserPlus } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { routes } from "@/lib/routing/routes"
import type { AccountRole } from "@/lib/auth/roles"
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

const roleLabels: Record<AccountRole, string> = {
  owner: "Workspace owner",
  admin: "Admin",
  agent: "Agent",
  viewer: "Viewer",
}

type NotificationItem = {
  id: string
  title: string
  body: string | null
  read_at: string | null
  conversation_id: string | null
}

type NotificationsResponse = { data: NotificationItem[] }

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || ""
  if (!source) return "?"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function Header({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { profile, account, accountRole, signOut } = useAuth()
  const { data: notificationsData } = useSWR<NotificationsResponse>("/api/v1/notifications", {
    refreshInterval: 60_000,
  })

  const segment = pathname.split("/").filter(Boolean)[0] ?? "dashboard"
  const title = titles[segment] ?? "Workspace"

  const notifications = notificationsData?.data ?? []
  const unread = notifications.filter((notification) => !notification.read_at)
  const recentNotifications = notifications.slice(0, 5)

  const displayName = profile?.full_name?.trim() || profile?.email || "Account"
  const displayEmail = profile?.email ?? ""
  const initials = initialsOf(profile?.full_name, profile?.email)
  const roleLabel = accountRole ? roleLabels[accountRole] : ""

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3 lg:px-4">
      <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="Open navigation" className="md:hidden"><Menu /></Button>
      <div className="hidden min-w-32 sm:block">
        <p className="truncate text-[10px] text-muted-foreground">{account?.name ?? "Workspace"}</p>
        <h1 className="truncate text-sm font-semibold">{title}</h1>
      </div>
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
          <DropdownMenuTrigger render={
            <Button variant="ghost" size="icon" aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"} className="relative">
              <Bell />
              {unread.length > 0 && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" aria-hidden="true" />}
            </Button>
          } />
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Notifications{unread.length > 0 ? ` (${unread.length} unread)` : ""}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {recentNotifications.length === 0 && (
                <DropdownMenuItem disabled>You&apos;re all caught up</DropdownMenuItem>
              )}
              {recentNotifications.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  onClick={() => router.push(notification.conversation_id ? `${routes.app.inbox}?conversation=${notification.conversation_id}` : routes.app.inbox)}
                >
                  <span className="min-w-0">
                    <span className={notification.read_at ? "block truncate text-muted-foreground" : "block truncate font-medium"}>{notification.title}</span>
                    {notification.body && <span className="block truncate text-xs text-muted-foreground">{notification.body}</span>}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Open account menu"><Avatar size="sm"><AvatarFallback className="bg-secondary font-semibold text-secondary-foreground">{initials}</AvatarFallback></Avatar></Button>} />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              {displayName}
              {roleLabel && <span className="block font-normal text-muted-foreground">{roleLabel}</span>}
              {displayEmail && <span className="block font-normal text-muted-foreground">{displayEmail}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push(routes.app.settings)}><Settings />Settings</DropdownMenuItem>
              <DropdownMenuItem onClick={handleSignOut}><LogOut />Sign out</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
