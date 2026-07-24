import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/features/auth/components/auth-shell";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
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

// The shell lives in the LAYOUT (not each page) so the indigo brand
// panel persists across login <-> signup <-> forgot-password
// navigations. Only the form column (children, remounted via
// template.tsx) animates — a premium cross-page transition without
// re-painting the whole screen.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
