'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/features/auth/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/features/settings/components/settings-rail';
import { SettingsOverview } from '@/features/settings/components/settings-overview';
import { ProfileForm } from '@/features/settings/components/profile-form';
import { SecurityPanel } from '@/features/settings/components/security-panel';
import { AppearancePanel } from '@/features/settings/components/appearance-panel';
import { ChannelConnections } from '@/features/settings/components/channel-connections';
import { QuickRepliesManager } from '@/features/settings/components/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/features/settings/components/fields-and-tags-panel';
import { DealsSettings } from '@/features/settings/components/deals-settings';
import { MembersTab } from '@/features/settings/components/members-tab';
import { ApiKeysSettings } from '@/features/settings/components/api-keys-settings';
import { ExternalSourcesSettings } from '@/features/settings/components/external-sources-settings';
import { SupportTab } from '@/features/settings/components/support-tab';
import {
  resolveSection,
  type SettingsSection,
} from '@/features/settings/components/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency]
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <ChannelConnections fixedChannel="whatsapp" />,
    sms: <ChannelConnections fixedChannel="sms" />,
    email: <ChannelConnections fixedChannel="email" />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
    'external-sources': <ExternalSourcesSettings />,
    support: <SupportTab />,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Bigin-style: no page-level heading/blurb — the rail says
          "Settings" and each panel carries its own title. */}
      <h1 className="sr-only">{t('pageTitle')}</h1>

      <div className="grid flex-1 gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="flex min-w-0 flex-col lg:self-stretch">
          {panel[section]}
        </div>
      </div>
    </div>
  );
}
