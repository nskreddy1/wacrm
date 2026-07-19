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
  LayoutTemplate,
  LogOut,
  Megaphone,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Settings,
  Users,
  Workflow,
} from "lucide-react"

import { AxonMark } from "@/components/brand/axon-logo"
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
import { personDisplayName, workspaceDisplayName } from "@/lib/display-name"
import { routes } from "@/lib/routing/routes"
import { cn } from "@/lib/utils"
import type { NavIconName } from "@/lib/navigation/config"
import type { AccountRole } from "@/lib/auth/roles"

/** Maps serializable icon names from the navigation API to lucide components. */
const navIcons: Record<NavIconName, ComponentType<{ className?: string }>> = {
  "git-branch": GitBranch,
  inbox: Inbox,
  "message-square": MessageSquare,
  users: Users,
  "calendar-days": CalendarDays,
  megaphone: Megaphone,
  workflow: Workflow,
  "git-fork": GitFork,
  bot: Bot,
  "layout-dashboard": LayoutDashboard,
  "layout-template": LayoutTemplate,
  settings: Settings,
}

const roleLabels: Record<AccountRole, string> = {
  owner: "Workspace owner",
  admin: "Admin",
  agent: "Agent",
  viewer: "Viewer",
}

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  // Derive initials from the friendly display name, never a raw email.
  const source = personDisplayName(name, email)
  if (!source || source === "Account") return "?"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function isActive(pathname: string, href: string) {
  // Exact-match-only routes: prefix matching would light them up for
  // sibling workspaces nested under the same segment (e.g. /inbox
  // must not appear active while the user is in /inbox/sms).
  if (href === "/dashboard" || href === "/inbox") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function BrandHeader() {
  const { account, loading } = useAuth()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          render={<Link href={routes.app.dashboard} aria-label="Workspace dashboard" />}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground">
            <AxonMark size={26} variant="mono" aria-hidden="true" />
          </span>
          <span className="grid flex-1 text-left leading-tight">
            {/* The workspace name IS the brand line — editable from
                Settings -> Team members and used globally. No duplicate
                subtitle underneath. */}
            {loading && !account ? (
              <span className="h-3.5 w-24 animate-pulse rounded bg-sidebar-accent" aria-hidden="true" />
            ) : (
              <span className="truncate text-sm font-semibold">
                {workspaceDisplayName(account?.name)}
              </span>
            )}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * Always-visible expand/collapse control. Lives in the header so it
 * is one click away in both states: a labeled row when expanded, an
 * icon with an animated "Expand sidebar" tooltip when collapsed.
 * The drag rail and Cmd/Ctrl+B shortcut keep working alongside it.
 */
function CollapseToggle() {
  const { toggleSidebar, state, isMobile } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={label}
          onClick={toggleSidebar}
          aria-label={label}
          className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
        >
          <PanelLeftClose
            aria-hidden="true"
            className={cn(
              "transition-transform duration-200",
              collapsed && "rotate-180",
            )}
          />
          <span>Collapse</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function NavGroups({ initialRole }: { initialRole: AccountRole | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const { groups } = useNavigation(initialRole)
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
                      tooltip={`Go to ${item.label}`}
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
  const { isMobile, setOpenMobile, state } = useSidebar()

  // In icon-collapsed mode the rail shows only the avatar, so the
  // dropdown must carry the full identity (name + role + email).
  // When expanded (or on mobile's sheet) the chip already shows
  // name + role, so repeating them in the menu would be duplication.
  const isCollapsed = state === "collapsed" && !isMobile

  // Friendly member name (e.g. "Admin"), never the raw email — the
  // email lives in the dropdown so identity isn't duplicated on the rail.
  const displayName = personDisplayName(profile?.full_name, profile?.email)
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
            {isCollapsed && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {displayName}
                    {roleLabel && (
                      <span className="block text-xs font-normal text-muted-foreground">{roleLabel}</span>
                    )}
                    {displayEmail && (
                      <span className="block font-normal text-muted-foreground">{displayEmail}</span>
                    )}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  router.push(routes.app.settings)
                  if (isMobile) setOpenMobile(false)
                }}
              >
                <Settings /> Settings
              </DropdownMenuItem>
              {/* Deep link into the Workspace name card so renaming is
                  one click from anywhere — the form itself stays in
                  Settings as the single source of truth. */}
              {(accountRole === "owner" || accountRole === "admin") && (
                <DropdownMenuItem
                  onClick={() => {
                    router.push(`${routes.app.settings}?tab=members`)
                    if (isMobile) setOpenMobile(false)
                  }}
                >
                  <Pencil /> Edit workspace name
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setMode("light")} aria-current={mode === "light" ? "true" : undefined}>
                <span
                  className={cn("size-2 rounded-full bg-foreground", mode !== "light" && "opacity-0")}
                  aria-hidden="true"
                />
                Light
                {mode === "light" && <span className="sr-only">Selected</span>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("dark")} aria-current={mode === "dark" ? "true" : undefined}>
                <span
                  className={cn("size-2 rounded-full bg-foreground", mode !== "dark" && "opacity-0")}
                  aria-hidden="true"
                />
                Dark
                {mode === "dark" && <span className="sr-only">Selected</span>}
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

export function AppSidebar({ initialRole = null }: { initialRole?: AccountRole | null }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <BrandHeader />
        <CollapseToggle />
      </SidebarHeader>
      <SidebarContent>
        <NavGroups initialRole={initialRole} />
      </SidebarContent>
      <SidebarFooter>
        <FooterMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
