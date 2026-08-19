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
import { MembersTab } from '@/features/settings/components/members-tab';
import { ActivityPanel } from '@/features/settings/components/activity-panel';
import { UsagePanel } from '@/features/settings/components/usage-panel';
// Restore with the deferred `integrations` panel entry below.
// import { IntegrationsPanel } from '@/features/settings/components/integrations-panel';
import { SupportTab } from '@/features/settings/components/support-tab';
import {
  resolveSection,
  type SettingsSection,
} from '@/features/settings/components/settings-sections';

/**
 * Stacks the panels of a merged section, separated by a rule.
 *
 * Several rail entries now host more than one panel (profile+appearance,
 * fields+currency). Each panel keeps its own
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
  // and the new panel opens mid-page. PageContainer is the page's only
  // scroller at every breakpoint now, so resetting it is the whole job.
  // `.app-scrollbar` is PageContainer's marker.
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
    // property of the data model, so it is now the "Currency" tab inside
    // this panel rather than a second stacked panel with its own heading.
    fields: <FieldsAndTagsPanel />,
    // DEFERRED with the `integrations` rail entry — see the "Integrations
    // is deferred" note in settings-sections.ts. This record is an
    // exhaustive Record<SettingsSection, ReactNode>, so this line and the
    // section list must be uncommented together.
    // integrations: <IntegrationsPanel />,
    activity: <ActivityPanel />,
    // One rail row per channel. `fixedChannel` makes ChannelConnections
    // render just that provider and drop its internal tab strip, so the
    // rail is the only channel switcher — no tabs nested inside tabs.
    // This is also the single source of truth for email: the legacy
    // always-visible SMTP form was removed because its prefilled
    // placeholders read like saved defaults and bypassed connection
    // testing.
    whatsapp: <ChannelConnections fixedChannel="whatsapp" />,
    sms: <ChannelConnections fixedChannel="sms" />,
    email: <ChannelConnections fixedChannel="email" />,
    'quick-replies': <QuickRepliesManager />,
    notifications: <NotificationsSettings />,
    support: <SupportTab />,
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {/* The page had no visible title at all — only an `sr-only` h1 — so
          the first thing on screen was the rail's "Account" group label. */}
      <header className="bg-background sticky top-0 z-10 -mx-4 shrink-0 px-4 pb-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:px-0 lg:pb-0">
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {t('pageTitle')}
        </h1>
      </header>

      {/* ONE scroll owner: PageContainer. Neither pane sets `overflow`, so
          content grows the page scroller instead of trapping the wheel in
          a nested pane. `lg:items-start` lets the rail collapse to its own
          height so it can stick (below) rather than stretch. */}
      <div className="grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        {/* Keyed by section so each panel mounts fresh. Several sections
            render the SAME component in this slot, and without a key React
            reuses that instance — every open sheet, selected row, and draft
            form from the previous section survived the switch. */}
        <div key={section} className="flex min-w-0 flex-col">
          {panel[section]}
        </div>
      </div>
    </div>
  );
}
