"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import useSWR from "swr"
import { Bell, ChevronDown, Command, Plus, Search, UserPlus } from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAuth } from "@/hooks/use-auth"
import { routes } from "@/lib/routing/routes"

const titles: Record<string, string> = {
  dashboard: "Dashboard",
  inbox: "Shared inbox",
  contacts: "Contacts",
  pipelines: "Pipelines",
  appointments: "Appointments",
  catalog: "Catalog",
  broadcasts: "Broadcasts",
  automations: "Automations",
  flows: "Flows",
  agents: "AI agents",
  notifications: "Notifications",
  settings: "Settings",
}

type NotificationItem = {
  id: string
  title: string
  body: string | null
  read_at: string | null
  conversation_id: string | null
}

type NotificationsResponse = { data: NotificationItem[] }

export function AppHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const { account } = useAuth()
  const { data: notificationsData } = useSWR<NotificationsResponse>("/api/v1/notifications", {
    refreshInterval: 60_000,
  })

  const segments = pathname.split("/").filter(Boolean)
  const segment = segments[0] ?? "dashboard"
  const title = titles[segment] ?? "Workspace"
  const isAutomationEditor =
    segment === "automations" &&
    (segments[1] === "new" || (segments[1] && segments[2] === "edit"))

  const notifications = notificationsData?.data ?? []
  const unread = notifications.filter((notification) => !notification.read_at)
  const recentNotifications = notifications.slice(0, 5)

  // The automation editor owns its command bar. Keeping both headers costs
  // valuable canvas height and creates competing save/create actions.
  if (isAutomationEditor) return null

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-2 sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="hidden h-4 sm:block" />
      <Breadcrumb className="hidden min-w-0 sm:block">
        <BreadcrumbList>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink render={<Link href={routes.app.dashboard} />}>
              {account?.name ?? "Workspace"}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <Button
        variant="outline"
        className="min-w-0 flex-1 justify-start text-muted-foreground sm:ml-auto sm:max-w-sm sm:flex-none md:w-64"
        aria-label="Search workspace"
      >
        <Search data-icon="inline-start" />
        <span className="truncate">Search...</span>
        <span className="ml-auto hidden items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] md:flex">
          <Command />K
        </span>
      </Button>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button className="hidden sm:flex">
                <Plus data-icon="inline-start" />
                Create
                <ChevronDown data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Create new</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => router.push(routes.app.contacts)}>
                <UserPlus />
                Contact
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(routes.app.pipelines)}>
                <Plus />
                Deal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(routes.app.appointments)}>
                <Plus />
                Appointment
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"}
                className="relative"
              >
                <Bell />
                {unread.length > 0 && (
                  <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" aria-hidden="true" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                Notifications{unread.length > 0 ? ` (${unread.length} unread)` : ""}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {recentNotifications.length === 0 && (
                <DropdownMenuItem disabled>You&apos;re all caught up</DropdownMenuItem>
              )}
              {recentNotifications.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  onClick={() =>
                    router.push(
                      notification.conversation_id
                        ? `${routes.app.inbox}?conversation=${notification.conversation_id}`
                        : routes.app.inbox
                    )
                  }
                >
                  <span className="min-w-0">
                    <span
                      className={
                        notification.read_at ? "block truncate text-muted-foreground" : "block truncate font-medium"
                      }
                    >
                      {notification.title}
                    </span>
                    {notification.body && (
                      <span className="block truncate text-xs text-muted-foreground">{notification.body}</span>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
