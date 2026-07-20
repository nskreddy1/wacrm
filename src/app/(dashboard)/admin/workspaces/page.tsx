import type { Metadata } from "next";

import { AdminWorkspaces } from "@/components/admin/admin-workspaces";

export const metadata: Metadata = { title: "Workspaces · Admin console" };

export default function AdminWorkspacesPage() {
  return <AdminWorkspaces />;
}
