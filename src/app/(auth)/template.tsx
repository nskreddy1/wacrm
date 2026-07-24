import type { ReactNode } from 'react';

// Next.js remounts template.tsx on every navigation within the (auth)
// group. That remount is what re-triggers the form column's entrance
// animation (`.auth-rise-block` in globals.css) when the user moves
// between sign-in, create-account, and forgot-password — while the
// brand panel in layout.tsx stays perfectly still.
export default function AuthTemplate({ children }: { children: ReactNode }) {
  return <div className="auth-rise-block w-full">{children}</div>;
}
