import type { Metadata } from 'next';

import { AdminWorkspaces } from '@/features/admin/components/admin-workspaces';

export const metadata: Metadata = { title: 'Workspaces · Admin console' };

export default function AdminWorkspacesPage() {
  return <AdminWorkspaces />;
}
