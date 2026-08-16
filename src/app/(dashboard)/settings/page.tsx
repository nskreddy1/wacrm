'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/features/auth/hooks/use-auth';
import { SettingsRail } from '@/features/settings/components/settings-rail';
import { ProfileForm } from '@/features/settings/components/profile-form';
import { SecurityPanel } from '@/features/settings/components/security-panel';
import { AppearancePanel } from '@/features/settings/components/appearance-panel';
import { ChannelConnections } from '@/features/settings/components/channel-connections';
import { QuickRepliesManager } from '@/features/settings/components/quick-replies-manager';
import { NotificationsSettings } from '@/features/settings/components/notifications-settings';
import { FieldsAndTagsPanel } from '@/features/settings/components/fields-and-tags-panel';
import { DealsSettings } from '@/features/settings/components/deals-settings';
import { MembersTab } from '@/features/settings/components/members-tab';
import { ActivityPanel } from '@/features/settings/components/activity-panel';
import { UsagePanel } from '@/features/settings/components/usage-panel';
import { ApiKeysSettings } from '@/features/settings/components/api-keys-settings';
import { ExternalSourcesSettings } from '@/features/settings/components/external-sources-settings';
import { SupportTab } from '@/features/settings/components/support-tab';
import {
  resolveSection,
  type SettingsSection,
} from '@/features/settings/components/settings-sections';

/**
 * Stacks the panels of a merged section, separated by a rule.
 *
 * Several rail entries now host more than one panel (profile+appearance,
 * fields+currency, external sources+API keys). Each panel keeps its own
 * `SettingsPanelHead`, which becomes a readable sub-heading — so nothing
 * had to be rewritten to merge them.
 */
function StackedPanels({ children }: { children: ReactNode[] }) {
  return (
    <div className="flex flex-col">
      {children.map((child, i) => (
        <div
          key={i}
          className={i > 0 ? 'border-border mt-8 border-t pt-8' : undefined}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency } = useAuth();
  const t = useTranslations('Settings');
  const rootRef = useRef<HTMLDivElement>(null);

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (appearance, whatsapp,
  // deals, api, …) resolve onto their merged home; unknown/empty →
  // DEFAULT_SECTION.
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // `scroll: false` above stops Next from jumping on a same-page
  // navigation, but it also means a stale offset survives the switch:
  // scroll down inside a long panel (Audit log), pick another section,
  // and the new panel opens mid-page. The desktop content pane resets
  // itself (it is keyed by section, so it remounts at scrollTop 0);
  // below `lg` the shared PageContainer scroller is the one that moved,
  // so reset it explicitly. `.app-scrollbar` is PageContainer's marker.
  useEffect(() => {
    const scroller = rootRef.current?.closest('.app-scrollbar');
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  }, [section]);

  // Cheap, fetch-free rail hints — only values already in context, so
  // the rail never triggers a request of its own.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({ fields: defaultCurrency }),
    [defaultCurrency]
  );

  const panel: Record<SettingsSection, ReactNode> = {
    // Appearance is device-local (localStorage) display preference, so it
    // belongs with the other personal profile settings.
    profile: (
      <StackedPanels>
        {[<ProfileForm key="profile" />, <AppearancePanel key="appearance" />]}
      </StackedPanels>
    ),
    security: <SecurityPanel />,
    members: <MembersTab />,
    usage: <UsagePanel />,
    // "Deals & currency" was a lone default-currency select; it reads as a
    // property of the data model, next to fields and tags.
    fields: (
      <StackedPanels>
        {[<FieldsAndTagsPanel key="fields" />, <DealsSettings key="deals" />]}
      </StackedPanels>
    ),
    integrations: (
      <StackedPanels>
        {[
          <ExternalSourcesSettings key="external" />,
          <ApiKeysSettings key="api" />,
        ]}
      </StackedPanels>
    ),
    activity: <ActivityPanel />,
    // One panel for every channel: ChannelConnections renders its own
    // email / whatsapp / sms tab strip when `fixedChannel` is omitted,
    // which is what the three separate rail rows were duplicating. It is
    // also the single source of truth for email — the legacy always-visible
    // SMTP form was removed because its prefilled placeholders read like
    // saved defaults and bypassed connection testing.
    channels: <ChannelConnections />,
    'quick-replies': <QuickRepliesManager />,
    notifications: <NotificationsSettings />,
    support: <SupportTab />,
  };

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col gap-4">
      {/* The page had no visible title at all — only an `sr-only` h1 — so
          the first thing on screen was the rail's "Account" group label. */}
      <header className="bg-background sticky top-0 z-10 -mx-4 shrink-0 px-4 pb-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:px-0 lg:pb-0">
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {t('pageTitle')}
        </h1>
      </header>

      {/* Two independent scroll panes below `lg` collapse to one column.
          `items-start` is gone: both panes must stretch so each can own
          its overflow instead of growing the page scroller. */}
      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[236px_minmax(0,1fr)]">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        {/* Keyed by section so each panel mounts fresh. Several sections
            render the SAME component in this slot, and without a key React
            reuses that instance — every open sheet, selected row, and draft
            form from the previous section survived the switch. Remounting
            also guarantees this pane starts at scrollTop 0. */}
        <div
          key={section}
          className="app-scrollbar flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto lg:pr-1"
        >
          {panel[section]}
        </div>
      </div>
    </div>
  );
}
