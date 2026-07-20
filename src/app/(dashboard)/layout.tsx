import type { Metadata } from "next";
import type { AccountRole } from "@/lib/auth/roles";
import { getSessionPayload, type SessionPayload } from "@/lib/auth/session-payload";
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
  // Resolve the viewer's FULL session (user + profile + account) on
  // the server so the first paint after login already renders the real
  // account name, greeting, and role-scoped navigation — no "Account"
  // placeholder flash while a client-side /api/v1/session fetch runs.
  // The payload seeds AuthProvider's SWR cache as fallbackData; SWR
  // still revalidates in the background, so profile edits propagate.
  // Falls back to null (viewer-safe subset + client fetch) if
  // resolution fails; proxy redirects unauthenticated visitors anyway.
  let initialSession: SessionPayload | null = null;
  let initialRole: AccountRole | null = null;
  try {
    initialSession = await getSessionPayload();
    initialRole = initialSession.data.profile.account_role;
  } catch {
    initialSession = null;
    initialRole = null;
  }

  return (
    <DashboardShell initialRole={initialRole} initialSession={initialSession}>
      {children}
    </DashboardShell>
  );
}
