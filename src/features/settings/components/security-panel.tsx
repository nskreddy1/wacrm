'use client';

import { DevicesCard } from './devices-card';
import { PasswordForm } from './password-form';
import { SettingsPanelHead } from './settings-panel-head';
import { useTranslations } from 'next-intl';

/**
 * "Login & security" — two disciplined sections, each a split
 * label/content card: password (with live strength meter) and
 * devices & sessions (per-device revoke + sign out everywhere as
 * the card footer). The old standalone sessions card merged into
 * the devices card so session control lives in exactly one place.
 */
export function SecurityPanel() {
  const t = useTranslations('Settings.security');
  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="flex flex-col gap-4">
        <PasswordForm />
        <DevicesCard />
      </div>
    </section>
  );
}
