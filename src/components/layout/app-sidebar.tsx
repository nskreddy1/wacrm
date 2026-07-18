"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { ComponentType } from "react"
import useSWR from "swr"
import {
  Bell,
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  Command,
  GitBranch,
  GitFork,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareText,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuth } from "@/hooks/use-auth"
import { useNavigation } from "@/hooks/use-navigation"
import { useTheme } from "@/hooks/use-theme"
import { useTotalUnread } from "@/hooks/use-total-unread"
import { routes } from "@/lib/routing/routes"
import type { NavIconName } from "@/lib/navigation/config"
import type { AccountRole } from "@/lib/auth/roles"

/** Maps serializable icon names from the navigation API to lucide components. */
const navIcons: Record<NavIconName, ComponentType<{ className?: string }>> = {
  "git-branch": GitBranch,
  inbox: Inbox,
  users: Users,
  "calendar-days": CalendarDays,
  megaphone: Megaphone,
  workflow: Workflow,
  "git-fork": GitFork,
  bot: Bot,
  "layout-dashboard": LayoutDashboard,
  settings: Settings,
}

const roleLabels: Record<AccountRole, string> = {
  owner: "Workspace owner",
  admin: "Admin",
  agent: "Agent",
  viewer: "Viewer",
}

const pageTitles: Record<string, string> = {
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

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`))
}

function BrandHeader() {
  const { account, loading } = useAuth()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          render={<Link href={routes.app.dashboard} aria-label="Relay CRM dashboard" />}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessageSquareText className="size-4" aria-hidden="true" />
          </span>
          <span className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm font-semibold">Relay CRM</span>
            {loading && !account ? (
              <span className="mt-0.5 h-2.5 w-20 animate-pulse rounded bg-sidebar-accent" aria-hidden="true" />
            ) : (
              <span className="truncate text-xs text-muted-foreground">{account?.name ?? "Workspace"}</span>
            )}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function WorkspaceActions() {
  const pathname = usePathname()
  const router = useRouter()
  const { account } = useAuth()
  const { isMobile, setOpenMobile } = useSidebar()
  const { data: notificationsData } = useSWR<NotificationsResponse>("/api/v1/notifications", {
    refreshInterval: 60_000,
  })

  const segment = pathname.split("/").filter(Boolean)[0] ?? "dashboard"
  const title = pageTitles[segment] ?? "Workspace"
  const notifications = notificationsData?.data ?? []
  const unreadCount = notifications.filter((notification) => !notification.read_at).length
  const recentNotifications = notifications.slice(0, 5)
  const unreadBadge = unreadCount > 0 ? (unreadCount > 99 ? "99+" : String(unreadCount)) : undefined
  const dropdownSide = isMobile ? "bottom" : "right"

  const navigate = (href: string) => {
    router.push(href)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupLabel>{account?.name ?? "Workspace"}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={`${account?.name ?? "Workspace"} / ${title}`} aria-label={`Current page: ${title}`}>
              <LayoutDashboard aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-xs text-muted-foreground">{account?.name ?? "Workspace"}</span>
                <span className="block truncate font-medium text-sidebar-foreground">{title}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Search workspace" aria-label="Search workspace">
              <Search aria-hidden="true" />
              <span>Search workspace</span>
              <span className="ml-auto flex items-center gap-1 rounded border border-sidebar-border px-1.5 py-0.5 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                <Command aria-hidden="true" />K
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton tooltip="Create" aria-label="Create new item">
                    <Plus aria-hidden="true" />
                    <span>Create</span>
                    <ChevronDown className="ml-auto" aria-hidden="true" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent side={dropdownSide} align="start" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Create new</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => navigate(routes.app.contacts)}>
                    <UserPlus /> Contact
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(routes.app.pipelines)}>
                    <Plus /> Deal
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(routes.app.bookings)}>
                    <CalendarDays /> Booking
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    tooltip={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
                    aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
                  >
                    <Bell aria-hidden="true" />
                    <span>Notifications</span>
                  </SidebarMenuButton>
                }
              />
              {unreadBadge && <SidebarMenuBadge>{unreadBadge}</SidebarMenuBadge>}
              <DropdownMenuContent side={dropdownSide} align="start" className="w-72">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    Notifications{unreadCount > 0 ? ` (${unreadCount} unread)` : ""}
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
                        navigate(
                          notification.conversation_id
                            ? `${routes.app.inbox}?conversation=${notification.conversation_id}`
                            : routes.app.inbox
                        )
                      }
                    >
                      <span className="min-w-0">
                        <span
                          className={
                            notification.read_at
                              ? "block truncate text-muted-foreground"
                              : "block truncate font-medium"
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
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => navigate(routes.app.notifications)}>
                    View all notifications
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function NavGroups() {
  const pathname = usePathname()
  const router = useRouter()
  const { groups } = useNavigation()
  const { isMobile, setOpenMobile } = useSidebar()
  const unreadCount = useTotalUnread()
  const unreadBadge = unreadCount > 0 ? (unreadCount > 99 ? "99+" : String(unreadCount)) : undefined

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.key}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = navIcons[item.icon] ?? LayoutDashboard
                const badge = item.counter === "inbox-unread" ? unreadBadge : undefined
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={isActive(pathname, item.href)}
                      render={
                        <Link
                          href={item.href}
                          prefetch
                          onMouseEnter={() => router.prefetch(item.href)}
                          onFocus={() => router.prefetch(item.href)}
                          onClick={() => {
                            if (isMobile) setOpenMobile(false)
                          }}
                        />
                      }
                    >
                      <Icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}

function FooterMenu() {
  const pathname = usePathname()
  const router = useRouter()
  const { mode, toggleMode } = useTheme()
  const { signOut, profile, accountRole } = useAuth()
  const { isMobile, setOpenMobile } = useSidebar()

  const displayName = profile?.full_name?.trim() || profile?.email || "Account"
  const displayEmail = profile?.email ?? ""
  const initials = initialsOf(profile?.full_name, profile?.email)
  const roleLabel = accountRole ? roleLabels[accountRole] : ""

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="Settings"
          isActive={isActive(pathname, "/settings")}
          render={
            <Link
              href={routes.app.settings}
              onClick={() => {
                if (isMobile) setOpenMobile(false)
              }}
            />
          }
        >
          <Settings aria-hidden="true" />
          <span>Settings</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={mode === "dark" ? "Light mode" : "Dark mode"}
          onClick={toggleMode}
          aria-label={mode === "dark" ? "Use light mode" : "Use dark mode"}
        >
          {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          <span>{mode === "dark" ? "Light mode" : "Dark mode"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                aria-label="Open account menu"
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar size="sm">
              <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate text-xs font-semibold">{displayName}</span>
              {roleLabel && <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>}
            </span>
            <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {displayName}
                {displayEmail && <span className="block font-normal text-muted-foreground">{displayEmail}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push(routes.app.settings)}>
                <Settings /> Workspace settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <BrandHeader />
          </div>
          <SidebarTrigger className="shrink-0" aria-label="Toggle sidebar" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <WorkspaceActions />
        <NavGroups />
      </SidebarContent>
      <SidebarFooter>
        <FooterMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
