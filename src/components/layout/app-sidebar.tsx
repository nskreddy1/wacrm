"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { ComponentType } from "react"
import {
  Bot,
  CalendarDays,
  ChevronsUpDown,
  GitBranch,
  GitFork,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
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
  const router = useRouter()
  const { mode, setMode } = useTheme()
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
              <DropdownMenuItem
                onClick={() => {
                  router.push(routes.app.settings)
                  if (isMobile) setOpenMobile(false)
                }}
              >
                <Settings /> Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setMode("light")}>
                <Sun /> Light
                <span className="ml-auto text-xs text-muted-foreground" aria-hidden="true">
                  {mode === "light" ? "Selected" : ""}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("dark")}>
                <Moon /> Dark
                <span className="ml-auto text-xs text-muted-foreground" aria-hidden="true">
                  {mode === "dark" ? "Selected" : ""}
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
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
        <BrandHeader />
      </SidebarHeader>
      <SidebarContent>
        <NavGroups />
      </SidebarContent>
      <SidebarFooter>
        <FooterMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
