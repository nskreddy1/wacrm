'use client';

import { DevicesCard } from './devices-card';
import { LoginActivityCard } from './login-activity-card';
import { PasswordForm } from './password-form';
import { SecuritySummary } from './security-summary';
import { SettingsPanelHead } from './settings-panel-head';
import { useTranslations } from 'next-intl';

/**
 * "Login & security" — structured as a security center:
 *
 * 1. Health strip: four at-a-glance facts (devices, last sign-in,
 *    failed attempts, lockout policy) so the "am I safe?" question
 *    is answered before any form is read.
 * 2. Credentials — change password, with live strength meter.
 * 3. Sessions — every logged-in device, per-device revoke, and the
 *    global sign-out-everywhere escape hatch.
 * 4. Activity — recent sign-in attempts with location, the audit
 *    trail that makes the other two sections actionable.
 *
 * Every section shares the same split left-rail card anatomy:
 * icon + name + "why this matters" on the left, controls on the
 * right. Eyebrow labels give the page an explicit scan order.
 */
export function SecurityPanel() {
  const t = useTranslations('Settings.security');

  const sections = [
    { eyebrow: t('sectionCredentials'), body: <PasswordForm /> },
    { eyebrow: t('sectionSessions'), body: <DevicesCard /> },
    { eyebrow: t('sectionActivity'), body: <LoginActivityCard /> },
  ];

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="flex flex-col gap-7">
        <SecuritySummary />

        {sections.map((section) => (
          <div key={section.eyebrow} className="flex flex-col gap-2">
            <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
              {section.eyebrow}
            </p>
            {section.body}
          </div>
        ))}
      </div>
    </section>
  );
}
