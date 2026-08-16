'use client';

import { useState } from 'react';

import { SettingsPanelHead } from './settings-panel-head';
import { SettingsTabStrip } from './settings-tab-strip';
import { ExternalSourcesSettings } from './external-sources-settings';
import { ApiKeysSettings } from './api-keys-settings';

type IntegrationsTab = 'sources' | 'api-keys';

const TABS: readonly { key: IntegrationsTab; label: string }[] = [
  { key: 'sources', label: 'External sources' },
  { key: 'api-keys', label: 'API keys' },
];

/**
 * "Integrations" — the merged home for the two developer/data-plumbing
 * surfaces that used to be separate rail rows under "Data
 * Administration".
 *
 * They are tabs rather than stacked panels because they are alternatives
 * (data coming *in* from an outside system vs. credentials for calling
 * *our* API), not a sequence: stacking them meant scrolling past the
 * whole external-sources table to reach the key list.
 */
export function IntegrationsPanel() {
  const [tab, setTab] = useState<IntegrationsTab>('sources');

  return (
    <section className="animate-in fade-in-50 flex flex-col gap-6 duration-200">
      <SettingsPanelHead
        title="Integrations"
        description="Connect outside systems to this workspace, and issue credentials for programmatic access."
      />

      <SettingsTabStrip
        tabs={TABS}
        active={tab}
        onSelect={setTab}
        label="Integrations"
      />

      {tab === 'sources' && <ExternalSourcesSettings embedded />}
      {tab === 'api-keys' && <ApiKeysSettings embedded />}
    </section>
  );
}
