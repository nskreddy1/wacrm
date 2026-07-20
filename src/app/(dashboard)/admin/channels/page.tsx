import type { Metadata } from "next";

import { AdminChannels } from "@/components/admin/admin-channels";

export const metadata: Metadata = { title: "Channels · Admin console" };

export default function AdminChannelsPage() {
  return <AdminChannels />;
}
