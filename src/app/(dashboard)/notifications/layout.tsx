import { PageContainer } from '@/components/layout/page-container';

export default function NotificationsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PageContainer>{children}</PageContainer>;
}
