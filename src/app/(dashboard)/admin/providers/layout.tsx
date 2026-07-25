import { redirect } from 'next/navigation';

import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { routes } from '@/lib/routing/routes';

// ============================================================
// /admin/providers — standalone provider operations page.
//
// Deliberately OUTSIDE the (console) route group: providers get
// their own sidebar entry and full-page canvas without the admin
// console tab chrome. Same defense-in-depth as the console:
// server-side super-admin gate here, /api/admin/* route gates,
// and RLS keyed on `profiles.is_super_admin`.
// ============================================================

export const dynamic = 'force-dynamic';

export default async function ProvidersLayout({
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
    <div className="flex h-0 min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      {/* Page shell: consistent breathing room on every edge and a
          readable max width, matching the rest of the dashboard. */}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Providers</h1>
        </header>
        {children}
      </div>
    </div>
  );
}
