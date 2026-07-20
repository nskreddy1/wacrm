import { redirect } from "next/navigation";

// /admin has no content of its own — the directory is the default view.
export default function AdminIndexPage() {
  redirect("/admin/workspaces");
}
