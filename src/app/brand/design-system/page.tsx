import type { Metadata } from 'next';
import { DesignSystemPreview } from '@/features/brand/components/design-system-preview';

export const metadata: Metadata = {
  title: 'Axon — UI System',
  description:
    'Static specification for page headers, typography, density and copy across the CRM.',
};

/**
 * Static UI system reference — no auth, no data, no DB.
 *
 * Deliberately outside the (dashboard) group so it renders without a
 * session and can be reviewed (and screenshotted) directly. Nothing here
 * imports app state, so it can never drift into a second source of truth
 * for real pages: it is a specimen sheet, and migration means moving the
 * PageHeader block into a shared component, not copying this file.
 */
export default function DesignSystemPage() {
  return <DesignSystemPreview />;
}
