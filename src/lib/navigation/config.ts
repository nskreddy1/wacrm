// ============================================================
// Workspace navigation config — single source of truth for the
// app shell nav, shared by the API route (server) and the
// sidebar fallback (client). Icons are referenced by name so the
// config stays serializable over the wire; the sidebar maps names
// to lucide components.
//
// `permission` gates items server-side per workspace-profile
// permission slug. Members without the slug see engage/insights
// surfaces but not automation builders.
// ============================================================

import {
  hasPermission,
  type PermissionSlug,
} from '@/features/auth/lib/permissions';

export type NavIconName =
  | 'git-branch'
  | 'inbox'
  | 'message-square'
  | 'users'
  | 'calendar-days'
  | 'package'
  | 'megaphone'
  | 'workflow'
  | 'git-fork'
  | 'bot'
  | 'layout-dashboard'
  | 'layout-template'
  | 'settings';

export interface NavItemConfig {
  key: string;
  href: string;
  label: string;
  /** Short label shown under the icon in the collapsed rail. */
  shortLabel?: string;
  icon: NavIconName;
  /** Which live counter (if any) the client should attach as a badge. */
  counter?: 'inbox-unread';
  /** Permission slug required to see this item. Omit for everyone. */
  permission?: PermissionSlug;
}

/**
 * Serializable access shape threaded from the server layout to the
 * sidebar so the first paint renders the fully scoped nav. `null`
 * means "session unknown" (loading / mock mode) → public subset.
 */
export interface NavAccess {
  permissions: readonly string[];
  isOwner: boolean;
}

export interface NavGroupConfig {
  key: string;
  label: string;
  items: NavItemConfig[];
}

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    key: 'engage',
    label: 'Engage',
    items: [
      {
        key: 'pipelines',
        href: '/pipelines',
        label: 'Pipelines',
        icon: 'git-branch',
      },
      {
        key: 'inbox',
        href: '/inbox',
        label: 'Inbox',
        icon: 'inbox',
        counter: 'inbox-unread',
      },
      {
        key: 'sms-inbox',
        href: '/inbox/sms',
        label: 'SMS Inbox',
        shortLabel: 'SMS',
        icon: 'message-square',
      },
      { key: 'contacts', href: '/contacts', label: 'Contacts', icon: 'users' },
      {
        key: 'appointments',
        href: '/appointments',
        label: 'Appointments',
        shortLabel: 'Schedule',
        icon: 'calendar-days',
      },
      {
        key: 'catalog',
        href: '/catalog',
        label: 'Catalog',
        shortLabel: 'Catalog',
        icon: 'package',
      },
    ],
  },
  {
    key: 'automate',
    label: 'Automate',
    items: [
      {
        key: 'broadcasts',
        href: '/broadcasts',
        label: 'Broadcasts',
        shortLabel: 'Campaigns',
        icon: 'megaphone',
        permission: 'broadcasts:send',
      },
      {
        key: 'templates',
        href: '/templates',
        label: 'Templates',
        shortLabel: 'Templates',
        icon: 'layout-template',
        permission: 'templates:manage',
      },
      {
        key: 'automations',
        href: '/automations',
        label: 'Automations',
        shortLabel: 'Rules',
        icon: 'workflow',
        permission: 'automations:manage',
      },
      {
        key: 'flows',
        href: '/flows',
        label: 'Flows',
        shortLabel: 'Flows',
        icon: 'git-fork',
        permission: 'flows:manage',
      },
      {
        key: 'agents',
        href: '/agents',
        label: 'AI agents',
        shortLabel: 'Agents',
        icon: 'bot',
        permission: 'ai:manage',
      },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    items: [
      {
        key: 'dashboard',
        href: '/dashboard',
        label: 'Dashboard',
        icon: 'layout-dashboard',
      },
    ],
  },
];

/**
 * Filter the nav config down to what the member may see. Groups that
 * end up empty are dropped entirely. A `null` access (session still
 * loading, mock mode) sees the ungated subset.
 */
export function navigationForAccess(
  access: NavAccess | null
): NavGroupConfig[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        !item.permission ||
        (access !== null &&
          hasPermission(access.permissions, item.permission, access.isOwner))
    ),
  })).filter((group) => group.items.length > 0);
}
