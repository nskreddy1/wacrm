import type { Metadata } from 'next';

import { AdminChannels } from '@/features/admin/components/admin-channels';

export const metadata: Metadata = { title: 'Channels · Admin console' };

export default function AdminChannelsPage() {
  return <AdminChannels />;
}
