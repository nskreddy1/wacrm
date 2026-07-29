import type { Metadata } from 'next';
import { UnifiedInboxPreview } from '@/features/brand/components/unified-inbox-preview';

export const metadata: Metadata = {
  title: 'Axon — Unified Inbox (design preview)',
  description:
    'Static design study for the omnichannel unified inbox. Sample data only.',
};

/**
 * Design-review surface for the unified inbox, deliberately kept OUT of the
 * real /inbox routes: it renders hardcoded sample data with no auth, DB or
 * realtime, so the layout can be judged (and screenshotted) before any of
 * the working channel-scoped inbox is touched.
 *
 * Static by construction — no cookies() or DB access — so it prerenders and
 * is reviewable without a session.
 */
export default function UnifiedInboxPreviewPage() {
  return <UnifiedInboxPreview />;
}
