import type { Metadata } from "next";
import { BookingWorkspace } from "@/components/bookings/booking-workspace";

export const metadata: Metadata = {
  title: "Bookings | WhatsApp CRM",
  description: "Manage locations, services, and customer appointments.",
};

export default function BookingsPage() {
  return <BookingWorkspace />;
}
