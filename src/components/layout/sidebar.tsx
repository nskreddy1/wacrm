"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, type ComponentType } from "react"
import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GitBranch,
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { useTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"

type NavItem = {
  href: string
  label: string
  shortLabel?: string
  icon: ComponentType<{ className?: string }>
  badge?: string
}

const primaryItems: NavItem[] = [
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "18" },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/broadcasts", label: "Broadcasts", shortLabel: "Campaigns", icon: Megaphone },
  { href: "/automations", label: "Automations", shortLabel: "Flows", icon: Workflow },
  { href: "/agents", label: "AI agents", shortLabel: "Agents", icon: Bot },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
]

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`))
}

function Brand({ compact }: { compact: boolean }) {
  return (
    <Link href="/dashboard" className={cn("flex h-12 items-center text-white", compact ? "justify-center" : "gap-3 px-4")} aria-label="Relay CRM dashboard">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-[#25d891]">
        <MessageSquareText aria-hidden="true" />
      </span>
      {!compact && <span className="min-w-0"><strong className="block truncate text-sm">Relay CRM</strong><span className="block truncate text-[10px] text-white/55">Acme Support</span></span>}
    </Link>
  )
}

function NavLink({ item, compact, pathname, onNavigate }: { item: NavItem; compact: boolean; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href)
  const link = (
    <Button
      render={<Link href={item.href} onClick={onNavigate} />}
      variant="ghost"
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative h-14 rounded-none text-white/72 hover:bg-white/8 hover:text-white",
        compact ? "w-full flex-col gap-1 px-1 text-[10px]" : "w-full justify-start gap-3 px-4",
        active && "bg-[#08b982] text-white hover:bg-[#08b982] hover:text-white"
      )}
    >
      <item.icon aria-hidden="true" />
      <span className={cn(compact ? "max-w-16 truncate text-[10px] font-semibold" : "truncate")}>{compact ? item.shortLabel ?? item.label : item.label}</span>
      {item.badge && <span className={cn("rounded-full bg-white/15 px-1.5 text-[9px]", compact ? "absolute right-1 top-1" : "ml-auto")}>{item.badge}</span>}
    </Button>
  )

  if (!compact) return link
  return <Tooltip><TooltipTrigger render={link} /><TooltipContent side="right">{item.label}</TooltipContent></Tooltip>
}

export function Sidebar({
  open = false,
  collapsed = true,
  onClose,
  onToggleCollapse,
}: {
  open?: boolean
  collapsed?: boolean
  onClose?: () => void
  onToggleCollapse?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { mode, toggleMode } = useTheme()
  const { signOut } = useAuth()

  useEffect(() => onClose?.(), [pathname, onClose])

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  return (
    <TooltipProvider delay={250}>
      <aside className={cn("hidden h-screen shrink-0 flex-col overflow-hidden bg-[#07475a] text-white transition-[width] duration-200 lg:flex", collapsed ? "w-[72px]" : "w-60")}>
        <Brand compact={collapsed} />
        <Separator className="bg-white/10" />
        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col py-1" aria-label="Primary navigation">
            {primaryItems.map((item) => <NavLink key={item.href} item={item} compact={collapsed} pathname={pathname} />)}
          </nav>
        </ScrollArea>
        <Separator className="mx-auto w-8 bg-white/15" />
        <div className="flex flex-col py-1">
          <NavLink item={{ href: "/settings", label: "Settings", icon: Settings }} compact={collapsed} pathname={pathname} />
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" onClick={toggleMode} aria-label={mode === "dark" ? "Use light mode" : "Use dark mode"} className={cn("h-11 rounded-none text-white/72 hover:bg-white/8 hover:text-white", collapsed ? "w-full" : "justify-start gap-3 px-4")} />}>
              {mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              {!collapsed && <span>{mode === "dark" ? "Light mode" : "Dark mode"}</span>}
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">{mode === "dark" ? "Light mode" : "Dark mode"}</TooltipContent>}
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" aria-label="Open account menu" className={cn("h-14 rounded-none text-white hover:bg-white/8", collapsed ? "w-full px-0" : "justify-start gap-3 px-4")} />} />}>
                <Avatar size="sm"><AvatarFallback className="bg-[#d9f7e9] font-semibold text-[#073b4c]">SS</AvatarFallback></Avatar>
                {!collapsed && <span className="min-w-0 text-left"><span className="block truncate text-xs font-semibold">Sam Silva</span><span className="block truncate text-[10px] text-white/50">Workspace owner</span></span>}
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right">Account</TooltipContent>}
            </Tooltip>
            <DropdownMenuContent side="right" align="end" className="w-56">
              <DropdownMenuLabel>Sam Silva<span className="block font-normal text-muted-foreground">sam@relaycrm.demo</span></DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => router.push("/settings")}> <Settings /> Workspace settings</DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}><LogOut /> Sign out demo</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" onClick={onToggleCollapse} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} className={cn("h-9 rounded-none text-white/60 hover:bg-white/8 hover:text-white", collapsed ? "w-full" : "justify-end px-4")} />}>
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Expand navigation</TooltipContent>}
          </Tooltip>
        </div>
      </aside>

      <div className={cn("fixed inset-0 z-50 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!open}>
        <button type="button" aria-label="Close navigation" onClick={onClose} className={cn("absolute inset-0 bg-foreground/30 transition-opacity", open ? "opacity-100" : "opacity-0")} />
        <aside className={cn("relative flex h-full w-72 flex-col bg-[#07475a] text-white shadow-xl transition-transform", open ? "translate-x-0" : "-translate-x-full")}>
          <Brand compact={false} />
          <Separator className="bg-white/10" />
          <ScrollArea className="min-h-0 flex-1">
            <nav className="flex flex-col py-1" aria-label="Mobile navigation">
              {primaryItems.map((item) => <NavLink key={item.href} item={item} compact={false} pathname={pathname} onNavigate={onClose} />)}
              <NavLink item={{ href: "/settings", label: "Settings", icon: Settings }} compact={false} pathname={pathname} onNavigate={onClose} />
            </nav>
          </ScrollArea>
          <Separator className="bg-white/10" />
          <div className="flex items-center gap-2 p-3">
            <Button variant="ghost" onClick={toggleMode} className="flex-1 justify-start text-white hover:bg-white/8 hover:text-white">{mode === "dark" ? <Sun /> : <Moon />} {mode === "dark" ? "Light" : "Dark"}</Button>
            <Button variant="ghost" onClick={handleSignOut} aria-label="Sign out" className="text-white hover:bg-white/8 hover:text-white"><LogOut /></Button>
          </div>
        </aside>
      </div>
    </TooltipProvider>
  )
}
