import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionPayload } from '@/features/auth/lib/session-payload';

// First-run wizard shell. The proxy already bounces unauthenticated
// visitors, so this layout only enforces the two BUSINESS rules:
//   - already onboarded -> straight to the dashboard (the wizard is
//     a one-way door, revisiting /onboarding must not resurrect it)
//   - non-owners -> dashboard (invited members join a workspace that
//     is already set up; every wizard step is owner-scoped anyway)
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set up your workspace',
  robots: { index: false, follow: false, nocache: true },
};

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let isOwner = false;
  let completed: string | null = null;
  try {
    const session = await getSessionPayload();
    isOwner = session.data.profile.is_owner;
    completed = session.data.account.onboarding_completed_at;
  } catch {
    redirect('/login');
  }

  if (!isOwner || completed !== null) {
    redirect('/dashboard');
  }

  return (
    <main className="bg-background flex min-h-svh flex-col items-center px-4 py-10 sm:py-16">
      {children}
    </main>
  );
}
