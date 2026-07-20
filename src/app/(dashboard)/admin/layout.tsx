import { redirect } from "next/navigation";

import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { routes } from "@/lib/routing/routes";
import { AdminNav } from "@/components/admin/admin-nav";

// ============================================================
// /admin — platform operator console (server-gated layout).
//
// Defense-in-depth layer 1 for the PAGES: the layout resolves
// `requireSuperAdmin()` on the server before rendering anything,
// so non-operators are redirected without ever receiving admin
// markup. Layers 2 and 3 remain the /api/admin/* route gates and
// the RLS policies keyed on `profiles.is_super_admin` — the UI is
// never the only check.
// ============================================================

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let authorized = false;
  try {
    await requireSuperAdmin();
    authorized = true;
  } catch {
    authorized = false;
  }
  if (!authorized) redirect(routes.app.dashboard);

  return (
    <div className="flex min-h-svh flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            Admin console
          </h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide workspace, support and channel operations. Every
            mutation is recorded in the audit trail.
          </p>
        </div>
        <AdminNav />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
