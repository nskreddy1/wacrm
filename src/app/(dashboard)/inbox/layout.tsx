import { BackendRequired, hasSupabaseEnvironment } from "@/components/layout/backend-required"

export default function InboxLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return hasSupabaseEnvironment() ? children : <BackendRequired module="Shared inbox" />
}
