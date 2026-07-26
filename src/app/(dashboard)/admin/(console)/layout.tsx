import { redirect } from 'next/navigation';

import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { routes } from '@/lib/routing/routes';
import { AdminSidebar } from '@/features/admin/components/admin-sidebar';

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

export const dynamic = 'force-dynamic';

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
    <div className="flex h-0 min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4 md:p-6">
      {/* Enterprise consoles are self-evident: a title and the nav,
          no explanatory paragraph. */}
      <h1 className="text-xl font-semibold tracking-tight text-balance">
        Admin console
      </h1>
      <div className="flex flex-col gap-5 md:flex-row md:gap-8">
        <AdminSidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
