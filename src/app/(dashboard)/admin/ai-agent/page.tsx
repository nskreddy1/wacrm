import type { Metadata } from "next";

import { AdminAiAgent } from "@/components/admin/admin-ai-agent";

export const metadata: Metadata = { title: "AI Agent · Admin console" };

export default function AdminAiAgentPage() {
  return <AdminAiAgent />;
}
