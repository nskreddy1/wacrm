import { BackendRequired, hasSupabaseEnvironment } from "@/components/layout/backend-required"

export default function AgentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return hasSupabaseEnvironment() ? children : <BackendRequired module="AI agents" />
}
