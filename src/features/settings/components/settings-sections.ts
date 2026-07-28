import {
  Activity,
  BellRing,
  Coins,
  Database,
  Gauge,
  KeyRound,
  LifeBuoy,
  Mail,
  MessageCircle,
  Palette,
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
 */
export const SETTINGS_SECTIONS = [
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'sms',
  'email',
  'quick-replies',
  'notifications',
  'fields',
  'deals',
  'members',
  'usage',
  'activity',
  'api',
  'external-sources',
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
  group:
    | 'account'
    | 'general'
    | 'customization'
    | 'channels'
    | 'data'
    | 'help';
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
  appearance: {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    group: 'account',
  },
  members: {
    id: 'members',
    label: 'Users and Controls',
    icon: UsersRound,
    group: 'general',
  },
  usage: {
    id: 'usage',
    label: 'Plan & usage',
    icon: Gauge,
    group: 'general',
  },
  activity: {
    id: 'activity',
    label: 'Audit log',
    icon: Activity,
    group: 'general',
  },
  fields: { id: 'fields', label: 'Fields', icon: Tags, group: 'customization' },
  deals: {
    id: 'deals',
    label: 'Deals & currency',
    icon: Coins,
    group: 'customization',
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    group: 'channels',
  },
  sms: { id: 'sms', label: 'SMS', icon: Smartphone, group: 'channels' },
  email: { id: 'email', label: 'Email', icon: Mail, group: 'channels' },
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
  'external-sources': {
    id: 'external-sources',
    label: 'External sources',
    icon: Database,
    group: 'data',
  },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'data' },
  support: { id: 'support', label: 'Support', icon: LifeBuoy, group: 'help' },
};

export const RAIL_GROUPS: {
  label: string | null;
  group: SectionMeta['group'];
}[] = [
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
 * merged "Fields & tags" section). Anything unknown falls back to
 * DEFAULT_SECTION.
 */
export function resolveSection(raw: string | null): SettingsSection {
  // Old merged "Channels" section → default to the WhatsApp panel
  // (the primary channel for this CRM).
  if (raw === 'channels') return 'whatsapp';
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  // Template management moved to the dedicated /templates studio, so
  // legacy deep links have no settings home — fall back to the default.
  if (raw === 'templates') return DEFAULT_SECTION;
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
