import type { ReactNode } from "react";

/**
 * Structural wrapper for dashboard pages. Intentionally has NO enter
 * animation: dashboard navigation is high-frequency, and re-running a
 * fade/rise on every route change made navigations feel like a page
 * reload. Content swaps instantly; SWR's `keepPreviousData` keeps data
 * on screen during transitions. The sidebar and chrome live in
 * layout.tsx and do not re-render.
 */
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
