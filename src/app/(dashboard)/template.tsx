import type { ReactNode } from "react";

/**
 * Remounted by Next.js on every navigation within the dashboard group,
 * re-running the `page-enter` animation — a fast (180ms), subtle fade
 * + 6px rise. Dashboard navigation is high-frequency, so the motion is
 * deliberately near-imperceptible; it bridges the content swap without
 * ever feeling slow. The sidebar and chrome live in layout.tsx and do
 * not re-render.
 */
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter flex min-h-0 flex-1 flex-col">{children}</div>;
}
