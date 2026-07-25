import type { Metadata } from 'next';

import { AdminPlatform } from '@/features/admin/components/admin-platform';

export const metadata: Metadata = { title: 'Platform · Admin console' };

export default function AdminPlatformPage() {
  return <AdminPlatform />;
}
