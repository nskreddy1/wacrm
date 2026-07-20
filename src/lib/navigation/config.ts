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
  | "message-square"
  | "users"
  | "calendar-days"
  | "package"
  | "megaphone"
  | "workflow"
  | "git-fork"
  | "bot"
  | "layout-dashboard"
  | "layout-template"
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
      { key: "sms-inbox", href: "/inbox/sms", label: "SMS Inbox", shortLabel: "SMS", icon: "message-square" },
      { key: "contacts", href: "/contacts", label: "Contacts", icon: "users" },
      { key: "appointments", href: "/appointments", label: "Appointments", shortLabel: "Schedule", icon: "calendar-days" },
      { key: "catalog", href: "/catalog", label: "Catalog", shortLabel: "Catalog", icon: "package" },
    ],
  },
  {
    key: "automate",
    label: "Automate",
    items: [
      { key: "broadcasts", href: "/broadcasts", label: "Broadcasts", shortLabel: "Campaigns", icon: "megaphone", minRole: "agent" },
      { key: "templates", href: "/templates", label: "Templates", shortLabel: "Templates", icon: "layout-template", minRole: "agent" },
      { key: "automations", href: "/automations", label: "Automations", shortLabel: "Rules", icon: "workflow", minRole: "agent" },
      { key: "flows", href: "/flows", label: "Flows", shortLabel: "Flows", icon: "git-fork", minRole: "agent" },
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
