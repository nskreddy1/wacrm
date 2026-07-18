// ============================================================
// Workspace navigation config — single source of truth for the
// app shell nav, shared by the API route (server) and the
// sidebar fallback (client). Icons are referenced by name so the
// config stays serializable over the wire; the sidebar maps names
// to lucide components.
//
// `minRole` gates items server-side per account role. Viewers see
// engage/insights surfaces but not automation builders.
// ============================================================

import type { AccountRole } from "@/lib/auth/roles"
import { hasMinRole } from "@/lib/auth/roles"

export type NavIconName =
  | "git-branch"
  | "inbox"
  | "users"
  | "calendar-days"
  | "megaphone"
  | "workflow"
  | "git-fork"
  | "bot"
  | "layout-dashboard"
  | "settings"

export interface NavItemConfig {
  key: string
  href: string
  label: string
  /** Short label shown under the icon in the collapsed rail. */
  shortLabel?: string
  icon: NavIconName
  /** Which live counter (if any) the client should attach as a badge. */
  counter?: "inbox-unread"
  /** Minimum account role required to see this item. Defaults to viewer (everyone). */
  minRole?: AccountRole
}

export interface NavGroupConfig {
  key: string
  label: string
  items: NavItemConfig[]
}

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    key: "engage",
    label: "Engage",
    items: [
      { key: "pipelines", href: "/pipelines", label: "Pipelines", icon: "git-branch" },
      { key: "inbox", href: "/inbox", label: "Inbox", icon: "inbox", counter: "inbox-unread" },
      { key: "contacts", href: "/contacts", label: "Contacts", icon: "users" },
      { key: "bookings", href: "/bookings", label: "Bookings", icon: "calendar-days" },
    ],
  },
  {
    key: "automate",
    label: "Automate",
    items: [
      { key: "broadcasts", href: "/broadcasts", label: "Broadcasts", shortLabel: "Campaigns", icon: "megaphone", minRole: "agent" },
      { key: "automations", href: "/automations", label: "Automations", shortLabel: "Automate", icon: "workflow", minRole: "agent" },
      { key: "agents", href: "/agents", label: "AI agents", shortLabel: "Agents", icon: "bot", minRole: "agent" },
    ],
  },
  {
    key: "insights",
    label: "Insights",
    items: [{ key: "dashboard", href: "/dashboard", label: "Dashboard", icon: "layout-dashboard" }],
  },
]

/**
 * Filter the nav config down to what `role` may see. Groups that end
 * up empty are dropped entirely. A `null` role (session still
 * loading, mock mode) sees the viewer-safe subset.
 */
export function navigationForRole(role: AccountRole | null): NavGroupConfig[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.minRole || (role !== null && hasMinRole(role, item.minRole))),
  })).filter((group) => group.items.length > 0)
}
