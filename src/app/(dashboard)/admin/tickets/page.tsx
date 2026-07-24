import type { Metadata } from "next";

import { AdminTickets } from "@/features/admin/components/admin-tickets";

export const metadata: Metadata = { title: "Tickets · Admin console" };

export default function AdminTicketsPage() {
  return <AdminTickets />;
}
