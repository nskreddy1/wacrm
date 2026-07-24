import type { Metadata } from 'next';

import { CatalogWorkspace } from '@/features/catalog/components/catalog-workspace';

export const metadata: Metadata = {
  title: 'Catalog',
  description:
    'Manage the services and products your team schedules and sells.',
};

export default function CatalogPage() {
  return <CatalogWorkspace />;
}
