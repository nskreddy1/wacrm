import { getSessionPayload } from '@/features/auth/lib/session-payload';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { OnboardingWizard } from '@/features/onboarding/components/onboarding-wizard';

// The layout has already verified: authenticated, owner, not yet
// onboarded. This page only assembles the wizard's initial data.
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSessionPayload();
  const account = session.data.account;

  // Free-plan allowances for the step-1 plan note. Failure here must
  // not block onboarding — the note simply omits the numbers.
  let contacts: number | null = null;
  let members: number | null = null;
  try {
    const { data: plan } = await supabaseAdmin()
      .from('plans')
      .select('max_contacts, max_members')
      .eq('id', 'free')
      .maybeSingle();
    contacts = (plan?.max_contacts as number | null) ?? null;
    members = (plan?.max_members as number | null) ?? null;
  } catch {
    // Plan note degrades gracefully.
  }

  return (
    <OnboardingWizard
      initialWorkspaceName={account.name}
      planSummary={{ contacts, members }}
    />
  );
}
