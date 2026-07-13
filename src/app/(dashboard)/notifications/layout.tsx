import { BackendRequired, hasSupabaseEnvironment } from "@/components/layout/backend-required"

export default function NotificationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return hasSupabaseEnvironment() ? children : <BackendRequired module="Notifications" />
}
