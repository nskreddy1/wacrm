import { BackendRequired, hasSupabaseEnvironment } from "@/components/layout/backend-required"

export default function NewAutomationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return hasSupabaseEnvironment() ? children : <BackendRequired module="Automation builder" />
}
