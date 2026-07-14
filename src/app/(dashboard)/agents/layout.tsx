import { PageContainer } from "@/components/layout/page-container"

export default function AgentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PageContainer>{children}</PageContainer>
}
