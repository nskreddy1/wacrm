import type { Metadata } from "next";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { DashboardShell } from "./dashboard-shell";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!hasSupabaseConfig()) {
    return <main className="min-h-screen bg-background">{children}</main>;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
