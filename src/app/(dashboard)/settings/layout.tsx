import { PageContainer } from '@/components/layout/page-container';

export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PageContainer>{children}</PageContainer>;
}
