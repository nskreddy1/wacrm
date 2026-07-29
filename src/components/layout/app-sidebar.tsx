'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ComponentType } from 'react';
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
  Package,
  PanelLeftClose,
  Pencil,
  Plug,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';

import { AxonMark } from '@/features/brand/components/axon-logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PresenceDot } from '@/features/presence/components/presence-dot';
import { useSelfPresence } from '@/features/presence/components/presence-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
} from '@/components/ui/sidebar';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useNavigation } from '@/hooks/use-navigation';
import { useTheme } from '@/hooks/use-theme';
import { useTotalUnread } from '@/features/inbox/hooks/use-total-unread';
import { personDisplayName, workspaceDisplayName } from '@/lib/display-name';
import { routes } from '@/lib/routing/routes';
import { cn } from '@/lib/utils';
import type { NavAccess, NavIconName } from '@/lib/navigation/config';

/** Maps serializable icon names from the navigation API to lucide components. */
const navIcons: Record<NavIconName, ComponentType<{ className?: string }>> = {
  'git-branch': GitBranch,
  inbox: Inbox,
  'message-square': MessageSquare,
  users: Users,
  'calendar-days': CalendarDays,
  package: Package,
  megaphone: Megaphone,
  workflow: Workflow,
  'git-fork': GitFork,
  bot: Bot,
  'layout-dashboard': LayoutDashboard,
  'layout-template': LayoutTemplate,
  settings: Settings,
};

function initialsOf(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  // Derive initials from the friendly display name, never a raw email.
  const source = personDisplayName(name, email);
  if (!source || source === 'Account') return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function isActive(pathname: string, href: string) {
  // Exact-match-only routes: prefix matching would light them up for
  // sibling workspaces nested under the same segment (e.g. /inbox
  // must not appear active while the user is in /inbox/sms).
  if (href === '/dashboard' || href === '/inbox') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandHeader() {
  const { account, loading } = useAuth();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          render={
            <Link
              href={routes.app.dashboard}
              aria-label="Workspace dashboard"
            />
          }
        >
          <span className="text-sidebar-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <AxonMark size={26} variant="mono" aria-hidden="true" />
          </span>
          <span className="grid flex-1 text-left leading-tight">
            {/* The workspace name IS the brand line — editable from
                Settings -> Team members and used globally. No duplicate
                subtitle underneath. */}
            {loading && !account ? (
              <span
                className="bg-sidebar-accent h-3.5 w-24 animate-pulse rounded"
                aria-hidden="true"
              />
            ) : (
              <span className="truncate text-sm font-semibold">
                {workspaceDisplayName(account?.name)}
              </span>
            )}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * Always-visible expand/collapse control. Lives in the header so it
 * is one click away in both states: a labeled row when expanded, an
 * icon with an animated "Expand sidebar" tooltip when collapsed.
 * The drag rail and Cmd/Ctrl+B shortcut keep working alongside it.
 */
function CollapseToggle() {
  const { toggleSidebar, state, isMobile } = useSidebar();
  const collapsed = state === 'collapsed' && !isMobile;
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  // On mobile the sidebar is a sheet, so there is no icon-rail state to
  // collapse into — the control would just close the sheet, duplicating
  // the overlay tap and the top bar's toggle. Hide it there.
  if (isMobile) return null;

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
              'transition-transform duration-200',
              collapsed && 'rotate-180'
            )}
          />
          <span>Collapse</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavGroups({ initialAccess }: { initialAccess: NavAccess | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { groups } = useNavigation(initialAccess);
  const { isMobile, setOpenMobile } = useSidebar();
  const unreadCount = useTotalUnread();
  const unreadBadge =
    unreadCount > 0
      ? unreadCount > 99
        ? '99+'
        : String(unreadCount)
      : undefined;

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.key}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = navIcons[item.icon] ?? LayoutDashboard;
                const badge =
                  item.counter === 'inbox-unread' ? unreadBadge : undefined;
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
                            if (isMobile) setOpenMobile(false);
                          }}
                        />
                      }
                    >
                      <Icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

/**
 * Platform-operator entry, rendered ONLY for super admins
 * (profiles.is_super_admin). Kept out of the role-scoped nav config
 * on purpose: super admin is a platform-level flag orthogonal to
 * workspace roles, and the UI here is layer 3 only — the /admin
 * layout's requireSuperAdmin() gate and RLS remain the real checks.
 */
function PlatformGroup() {
  const pathname = usePathname();
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  if (!isSuperAdmin) return null;

  const items = [
    {
      href: '/admin/workspaces',
      label: 'Admin console',
      icon: ShieldCheck,
      // /admin is active for every sub-page EXCEPT providers, which
      // has its own dedicated entry below.
      active:
        isActive(pathname, '/admin') &&
        !pathname.startsWith('/admin/providers'),
    },
    {
      href: '/admin/providers',
      label: 'Providers',
      icon: Plug,
      active: pathname.startsWith('/admin/providers'),
    },
  ];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                tooltip={`Go to ${item.label}`}
                isActive={item.active}
                render={
                  <Link
                    href={item.href}
                    prefetch
                    onMouseEnter={() => router.prefetch(item.href)}
                    onFocus={() => router.prefetch(item.href)}
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                    }}
                  />
                }
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function FooterMenu() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const { signOut, profile, isOwner, canEditSettings, workspaceProfile } =
    useAuth();
  const { isMobile, setOpenMobile, state } = useSidebar();
  // Reads the status the app is already publishing — no extra realtime
  // channel or roster fetch just to render one dot.
  const selfStatus = useSelfPresence();

  // In icon-collapsed mode the rail shows only the avatar, so the
  // dropdown must carry the full identity (name + role + email).
  // When expanded (or on mobile's sheet) the chip already shows
  // name + role, so repeating them in the menu would be duplication.
  const isCollapsed = state === 'collapsed' && !isMobile;

  // Friendly member name (e.g. "Admin"), never the raw email — the
  // email lives in the dropdown so identity isn't duplicated on the rail.
  const displayName = personDisplayName(profile?.full_name, profile?.email);
  const displayEmail = profile?.email ?? '';
  const initials = initialsOf(profile?.full_name, profile?.email);
  // Identity line is synced with the assigned workspace profile for
  // everyone — the owner is auto-assigned the "Administrator" system
  // profile at signup, so this reflects the same default profile
  // shown in Settings instead of a hardcoded "Super Admin" label.
  const roleLabel = workspaceProfile?.name ?? (isOwner ? 'Administrator' : '');

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

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
            {/* relative wrapper, not the Avatar itself: the dot is
                absolutely positioned against it and must not be clipped
                by the avatar's own rounded overflow. */}
            <span className="relative shrink-0">
              <Avatar size="sm">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {/* ring matches the sidebar surface so the dot reads as a
                  cutout rather than a sticker. aria-hidden: the menu
                  states the status in words, so announcing it twice
                  would just be noise. */}
              <PresenceDot
                status={selfStatus}
                className="ring-sidebar absolute -end-0.5 -bottom-0.5 size-2.5 ring-2"
              />
            </span>
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate text-xs font-semibold">
                {displayName}
              </span>
              {roleLabel && (
                <span className="text-muted-foreground truncate text-xs">
                  {roleLabel}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            className="w-56"
          >
            {isCollapsed && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {displayName}
                    {roleLabel && (
                      <span className="text-muted-foreground block text-xs font-normal">
                        {roleLabel}
                      </span>
                    )}
                    {displayEmail && (
                      <span className="text-muted-foreground block font-normal">
                        {displayEmail}
                      </span>
                    )}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  router.push(routes.app.settings);
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <Settings /> Settings
              </DropdownMenuItem>
              {/* Deep link into the Workspace name card so renaming is
                  one click from anywhere — the form itself stays in
                  Settings as the single source of truth. */}
              {canEditSettings && (
                <DropdownMenuItem
                  onClick={() => {
                    router.push(`${routes.app.settings}?tab=members`);
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  <Pencil /> Edit workspace name
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setMode('light')}
                aria-current={mode === 'light' ? 'true' : undefined}
              >
                <span
                  className={cn(
                    'bg-foreground size-2 rounded-full',
                    mode !== 'light' && 'opacity-0'
                  )}
                  aria-hidden="true"
                />
                Light
                {mode === 'light' && <span className="sr-only">Selected</span>}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setMode('dark')}
                aria-current={mode === 'dark' ? 'true' : undefined}
              >
                <span
                  className={cn(
                    'bg-foreground size-2 rounded-full',
                    mode !== 'dark' && 'opacity-0'
                  )}
                  aria-hidden="true"
                />
                Dark
                {mode === 'dark' && <span className="sr-only">Selected</span>}
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
  );
}

export function AppSidebar({
  initialAccess = null,
}: {
  initialAccess?: NavAccess | null;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <BrandHeader />
        <CollapseToggle />
      </SidebarHeader>
      {/* The sidebar primitive renders plain <div>s, so the app had no
          navigation landmark at all — screen reader users could not jump to
          the nav. Marking the link region as one satisfies WCAG 1.3.1. */}
      <SidebarContent aria-label="Main navigation" role="navigation">
        <NavGroups initialAccess={initialAccess} />
        <PlatformGroup />
      </SidebarContent>
      <SidebarFooter>
        <FooterMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
