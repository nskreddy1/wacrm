import {
  Coins,
  Database,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Palette,
  PlugZap,
  Shield,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'channels',
  'quick-replies',
  'fields',
  'deals',
  'members',
  'api',
  'external-sources',
  'support',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/**
 * Rail grouping — enterprise IA modelled on Bigin/Zoho and HubSpot:
 * scope first (Account vs org), then function (General → admin,
 * Customization → data model, Channels → communication, Data
 * Administration → integrations/developer). `help` renders unlabeled
 * at the bottom of the rail.
 */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'general' | 'customization' | 'channels' | 'data' | 'help';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  members: { id: 'members', label: 'Users and Controls', icon: UsersRound, group: 'general' },
  fields: { id: 'fields', label: 'Fields', icon: Tags, group: 'customization' },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'customization' },
  channels: { id: 'channels', label: 'Channels', icon: PlugZap, group: 'channels' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'channels' },
  'external-sources': { id: 'external-sources', label: 'External sources', icon: Database, group: 'data' },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'data' },
  support: { id: 'support', label: 'Support', icon: LifeBuoy, group: 'help' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'General', group: 'general' },
  { label: 'Customization', group: 'customization' },
  { label: 'Channels', group: 'channels' },
  { label: 'Data Administration', group: 'data' },
  { label: null, group: 'help' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'whatsapp') return 'channels';
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  // Template management moved to the dedicated /templates studio;
  // legacy deep links land on the Overview which points there.
  if (raw === 'templates') return DEFAULT_SECTION;
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
