import { BackendRequired, hasSupabaseEnvironment } from "@/components/layout/backend-required"

export default function BookingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return hasSupabaseEnvironment() ? children : <BackendRequired module="Bookings" />
}
