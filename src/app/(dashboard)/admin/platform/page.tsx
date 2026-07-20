import type { Metadata } from "next";

import { AdminPlatform } from "@/components/admin/admin-platform";

export const metadata: Metadata = { title: "Platform · Admin console" };

export default function AdminPlatformPage() {
  return <AdminPlatform />;
}
