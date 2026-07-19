import type { Metadata } from "next";
import { getCurrentAccount } from "@/lib/auth/account";
import type { AccountRole } from "@/lib/auth/roles";
import { DashboardShell } from "./dashboard-shell";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the viewer's role on the server so the sidebar's first
  // paint already shows the full role-scoped navigation — no staged
  // "few items now, more items later" flash. getCurrentAccount() is
  // request-cached, so route handlers/pages resolving it in the same
  // request pay zero extra queries. Falls back to null (viewer-safe
  // subset) if resolution fails; proxy will redirect unauthenticated
  // visitors anyway.
  let initialRole: AccountRole | null = null;
  try {
    const account = await getCurrentAccount();
    initialRole = account.role;
  } catch {
    initialRole = null;
  }

  return <DashboardShell initialRole={initialRole}>{children}</DashboardShell>;
}
