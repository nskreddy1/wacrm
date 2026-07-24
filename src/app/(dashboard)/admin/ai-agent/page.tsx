import type { Metadata } from "next";

import { AdminAiAgent } from "@/features/admin/components/admin-ai-agent";

export const metadata: Metadata = { title: "AI Agent · Admin console" };

export default function AdminAiAgentPage() {
  return <AdminAiAgent />;
}
