import type { Metadata } from 'next';

import { AdminPlans } from '@/features/admin/components/admin-plans';

export const metadata: Metadata = { title: 'Plans · Admin console' };

export default function AdminPlansPage() {
  return <AdminPlans />;
}
