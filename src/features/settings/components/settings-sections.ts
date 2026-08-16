import {
  Activity,
  BellRing,
  // Database — restore this import with the deferred `integrations` section.
  Gauge,
  LifeBuoy,
  Mail,
  MessageCircle,
  Shield,
  Smartphone,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail. The URL query param
 * stays `?tab=` (deep-linkable, and it keeps the existing links in
 * sidebar.tsx / header.tsx working) — we just map the old values onto
 * the new sections.
 *
 * ## Why the rail is deliberately short
 *
 * The rail previously listed 16 sections across 6 labelled groups, which
 * computed to ~856px of intrinsic height. On a 632px-tall window with
 * `lg:p-8` padding there is only ~520px of usable column, so the last
 * four entries (External sources, API keys, Support, …) sat below the
 * fold — and because the rail is `lg:sticky` while being taller than its
 * viewport, reaching them required scrolling the shared page scroller.
 * Selecting a section then kept that stale offset (`scroll: false`), so
 * the panel appeared to open "mid-page".
 *
 * The fix is structural, not cosmetic: collapse sections that were split
 * more finely than their content justified, and never spend a ~34px
 * group heading on a group holding a single ~32px row.
 *
 * Merges applied (each is a pure re-parenting — no panel was deleted):
 * - Deals & currency → `fields`. "Deals & currency" was a single
 *   `<select>` writing `accounts.default_currency`; it never contained
 *   any deal settings.
 * - External sources + API keys → `integrations`. Both are developer /
 *   data-plumbing surfaces that shared the old "Data Administration".
 *   (This merged section is now DEFERRED — see the note below.)
 * - Appearance → `profile`. Appearance persists to localStorage only
 *   (device-scoped), exactly like the other personal display prefs.
 *
 * ## Channels are one row each
 *
 * WhatsApp, SMS and Email are separate rail rows. They share the one
 * `<ChannelConnections>` component, which renders a single channel when
 * given `fixedChannel` and its own tab strip when the prop is omitted —
 * so a merged row meant a tab strip nested inside the rail, and picking
 * "Channels" then still left you one click from the provider you wanted.
 * Three rows make each channel a direct destination and let the rail
 * show at a glance which surfaces exist.
 *
 * This costs two extra rows against the height budget described above.
 * That fits because `integrations` was deferred at the same time and the
 * rail now stands at 12 rows / 3 headings, well under the 16 / 6 that
 * originally overflowed. Adding further rows needs the same math redone.
 *
 * Groups were folded too: `customization` and `data` each held one row,
 * so their headings cost more vertical space than their contents. Both
 * now live under `workspace`.
 *
 * Support is intentionally KEPT (in the unlabeled trailing group): it is
 * the user half of two-way ticketing backed by `/api/support/tickets`,
 * and Settings is currently its only entry point. Dropping it from the
 * rail would orphan a live feature, and it costs one row with no heading.
 *
 * ## Integrations is deferred
 *
 * The `integrations` section (External sources + API keys) is commented
 * out rather than deleted — it ships when a client actually needs it.
 * The External sources half is a partly-built data-connection surface
 * with no guided setup, so exposing it invited a dead end; API keys came
 * along with it because the two share the one merged panel.
 *
 * Nothing was removed from disk. `integrations-panel.tsx`,
 * `external-sources-settings.tsx`, `api-keys-settings.tsx`, the
 * `/api/external-sources/*` and `/api/v1/integrations/*` routes, and the
 * `integration_connections` / `integration_operations` tables are all
 * untouched and still enforce their own auth — only the settings entry
 * point is hidden.
 *
 * To restore, uncomment in this file: the SETTINGS_SECTIONS entry, the
 * SECTION_META record, the `Database` icon import, and the
 * resolveSection alias (replacing the DEFAULT_SECTION fallback) — then
 * the `integrations` entry in the panel map in settings/page.tsx. The
 * panel map is an exhaustive Record<SettingsSection, ReactNode>, so
 * typecheck will fail until both files agree.
 *
 * Known consequence while deferred: there is no UI to mint a `/api/v1`
 * key, since ApiKeysSettings was the only such surface. Keys already
 * issued keep working — the routes that verify them are untouched.
 */
export const SETTINGS_SECTIONS = [
  // Account — personal, device- or user-scoped.
  'profile',
  'security',
  // Workspace — org configuration and administration.
  'members',
  'usage',
  'fields',
  // 'integrations' — DEFERRED, see the "Integrations is deferred" note
  // below before re-enabling. Restoring it needs this entry, its
  // SECTION_META record, the `Database` icon import, the resolveSection
  // alias, and the panel map entry in settings/page.tsx.
  'activity',
  // Channels — one row per communication surface, so connecting a
  // provider is a direct destination rather than a tab inside a tab.
  'whatsapp',
  'sms',
  'email',
  'quick-replies',
  'notifications',
  // Unlabeled trailing group.
  'support',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Landing section for `/settings` with no (or an unknown) `?tab=`.
 *
 * Was the `overview` dashboard, which mostly re-listed sections already
 * present in the rail. With it gone, "Your profile" is the natural first
 * stop — it is the top rail entry and always available to every member.
 */
export const DEFAULT_SECTION: SettingsSection = 'profile';

/**
 * Rail grouping — scope first (Account vs workspace), then function
 * (Channels → communication). `help` renders unlabeled at the bottom.
 */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'account' | 'workspace' | 'channels' | 'help';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  profile: {
    id: 'profile',
    label: 'Your profile',
    icon: User,
    group: 'account',
  },
  security: {
    id: 'security',
    label: 'Login & security',
    icon: Shield,
    group: 'account',
  },
  members: {
    id: 'members',
    label: 'Users and Controls',
    icon: UsersRound,
    group: 'workspace',
  },
  usage: {
    id: 'usage',
    label: 'Plan & usage',
    icon: Gauge,
    group: 'workspace',
  },
  fields: {
    id: 'fields',
    label: 'Fields & currency',
    icon: Tags,
    group: 'workspace',
  },
  // DEFERRED alongside the SETTINGS_SECTIONS entry above.
  // integrations: {
  //   id: 'integrations',
  //   label: 'Integrations',
  //   icon: Database,
  //   group: 'workspace',
  // },
  activity: {
    id: 'activity',
    label: 'Audit log',
    icon: Activity,
    group: 'workspace',
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    group: 'channels',
  },
  sms: {
    id: 'sms',
    label: 'SMS',
    icon: Smartphone,
    group: 'channels',
  },
  email: {
    id: 'email',
    label: 'Email',
    icon: Mail,
    group: 'channels',
  },
  'quick-replies': {
    id: 'quick-replies',
    label: 'Quick replies',
    icon: Zap,
    group: 'channels',
  },
  notifications: {
    id: 'notifications',
    label: 'Notifications',
    icon: BellRing,
    group: 'channels',
  },
  support: { id: 'support', label: 'Support', icon: LifeBuoy, group: 'help' },
};

export const RAIL_GROUPS: {
  label: string | null;
  group: SectionMeta['group'];
}[] = [
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
  { label: 'Channels', group: 'channels' },
  { label: null, group: 'help' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section.
 *
 * Every value that was ever a valid tab still resolves, so existing
 * bookmarks and in-app deep links keep working after the merges above.
 * Anything unknown falls back to DEFAULT_SECTION.
 */
export function resolveSection(raw: string | null): SettingsSection {
  // `whatsapp` / `sms` / `email` are real sections again, so they fall
  // through to isSection below. The merged `channels` value stays mapped
  // for bookmarks made while the three were one panel — WhatsApp is the
  // primary channel of this product, so it is the natural landing row.
  if (raw === 'channels') return 'whatsapp';
  // Tags and custom fields merged into "Fields" earlier; currency joined
  // it here (it was a lone select under "Deals & currency").
  if (raw === 'tags' || raw === 'custom-fields' || raw === 'deals')
    return 'fields';
  // Developer/data surfaces merged into one tabbed panel, now deferred.
  // While deferred these must NOT return 'integrations' — that section is
  // no longer in SETTINGS_SECTIONS, so the panel map would have no entry
  // for it and the page would render a blank pane. Fall through to the
  // default instead. Restore the line below when re-enabling:
  //   if (raw === 'api' || raw === 'external-sources') return 'integrations';
  if (raw === 'api' || raw === 'external-sources' || raw === 'integrations')
    return DEFAULT_SECTION;
  // Appearance is a personal display pref, shown with the profile.
  if (raw === 'appearance') return 'profile';
  // Template management moved to the dedicated /templates studio, so
  // legacy deep links have no settings home — fall back to the default.
  if (raw === 'templates') return DEFAULT_SECTION;
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
