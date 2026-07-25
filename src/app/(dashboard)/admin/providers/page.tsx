import type { Metadata } from 'next';

import { AdminProviders } from '@/features/admin/components/admin-providers';

export const metadata: Metadata = {
  title: 'Providers — Admin console',
  description:
    'Platform-wide provider catalog and tenant connection overview.',
};

// Auth is enforced by the /admin layout (requireSuperAdmin) and again
// by every /api/admin/providers call — this page renders no data of
// its own.
export default function AdminProvidersPage() {
  return <AdminProviders />;
}
