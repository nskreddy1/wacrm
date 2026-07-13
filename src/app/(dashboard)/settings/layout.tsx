import { BackendRequired, hasSupabaseEnvironment } from "@/components/layout/backend-required"

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return hasSupabaseEnvironment() ? children : <BackendRequired module="Settings" />
}
