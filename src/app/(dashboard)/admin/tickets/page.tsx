import type { Metadata } from "next";

import { AdminTickets } from "@/components/admin/admin-tickets";

export const metadata: Metadata = { title: "Tickets · Admin console" };

export default function AdminTicketsPage() {
  return <AdminTickets />;
}
