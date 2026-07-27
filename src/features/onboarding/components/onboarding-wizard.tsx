'use client';

// ============================================================
// First-run wizard (owners only — the layout enforces that).
//
// Design notes (deliberate, per the design-engineering pass):
//   - One signature element: the numbered progress rail. Steps are
//     a true sequence here, so numbering carries real information.
//   - Motion budget: entrances only, 200ms ease-out, 40ms stagger.
//     No exit choreography — advancing a step swaps content fast.
//   - Buttons scale to 0.97 on press (feedback, not decoration).
//   - Reduced motion collapses everything to opacity.
//
// Failure posture: every network call surfaces its error inline and
// leaves the user ON the step so nothing is silently lost. The only
// hard navigation is the final replace() after completion succeeds.
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Loader2, Mail, MessageSquareText, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STEPS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'channel', label: 'Channel' },
  { id: 'team', label: 'Team' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

interface Props {
  initialWorkspaceName: string;
  /** Free-plan allowances shown on step 1 so expectations are set early. */
  planSummary: { contacts: number | null; members: number | null };
}

async function postOnboarding(payload: {
  workspace_name?: string;
  complete?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/account/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, error: data?.error ?? 'Something went wrong. Try again.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error. Check your connection and try again.' };
  }
}

export function OnboardingWizard({ initialWorkspaceName, planSummary }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<StepId>('workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState(initialWorkspaceName);

  // Step 3
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');
  const [invited, setInvited] = useState<string[]>([]);

  const stepIndex = useMemo(() => STEPS.findIndex((s) => s.id === step), [step]);

  const advance = useCallback(() => {
    setError(null);
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.id);
  }, [stepIndex]);

  const saveWorkspace = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Workspace name needs at least 2 characters.');
      return;
    }
    setBusy(true);
    const result = await postOnboarding({ workspace_name: trimmed });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    advance();
  }, [name, advance]);

  const sendInvite = useCallback(async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (invited.includes(email)) {
      setError('That address already has a pending invite.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: inviteRole, email, label: 'Onboarding invite' }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? 'Could not create the invite.');
        return;
      }
      setInvited((prev) => [...prev, email]);
      setInviteEmail('');
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [inviteEmail, inviteRole, invited]);

  const finish = useCallback(async () => {
    setBusy(true);
    const result = await postOnboarding({ complete: true });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // replace(): the wizard is a one-way door — Back must not resurrect it.
    // `welcome=1` triggers the full-screen 3D welcome overlay on landing.
    router.replace('/dashboard?welcome=1');
    router.refresh();
  }, [router]);

  return (
    <div className="flex w-full max-w-md flex-col gap-10">
      {/* Progress rail — the steps ARE a sequence, so numbers carry meaning */}
      <nav aria-label="Setup progress">
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const state =
              i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'todo';
            return (
              <li key={s.id} className="flex flex-1 flex-col gap-2">
                <span
                  aria-hidden
                  className={`h-1 rounded-full transition-colors duration-200 ease-out ${
                    state === 'todo' ? 'bg-border' : 'bg-primary'
                  }`}
                />
                <span
                  className={`flex items-center gap-1.5 text-xs font-medium transition-colors duration-200 ease-out ${
                    state === 'active'
                      ? 'text-foreground'
                      : state === 'done'
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/60'
                  }`}
                >
                  {state === 'done' ? (
                    <Check className="size-3" aria-hidden />
                  ) : (
                    <span aria-hidden>{i + 1}.</span>
                  )}
                  {s.label}
                  {state === 'active' && (
                    <span className="sr-only">(current step)</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step content — keyed so entrance animation replays per step */}
      <section
        key={step}
        aria-live="polite"
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 flex flex-col gap-6 duration-200 ease-out"
      >
        {step === 'workspace' && (
          <>
            <header className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                Name your workspace
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                This is what your team will see. You can change it any time in
                Settings.
              </p>
            </header>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ws-name">Workspace name</Label>
              <Input
                id="ws-name"
                value={name}
                maxLength={120}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  )
                    void saveWorkspace();
                }}
                placeholder="Acme Support"
              />
            </div>
            <div className="border-border text-muted-foreground rounded-lg border border-dashed p-3 text-xs leading-relaxed">
              You&apos;re on the <span className="text-foreground font-medium">Free plan</span>
              {planSummary.contacts !== null && (
                <> — up to {planSummary.contacts.toLocaleString()} contacts</>
              )}
              {planSummary.members !== null && (
                <> and {planSummary.members} member seats</>
              )}
              . Upgrade later from Settings → Plan &amp; usage.
            </div>
          </>
        )}

        {step === 'channel' && (
          <>
            <header className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                Connect a channel
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Channels are where conversations come from. Connecting one needs
                provider credentials, so it lives in Settings — this step just
                shows you the door.
              </p>
            </header>
            <ul className="flex flex-col gap-2">
              {[
                {
                  icon: MessageSquareText,
                  title: 'WhatsApp, SMS & more',
                  body: 'Connect providers under Settings → Channels once you finish setup.',
                },
                {
                  icon: Mail,
                  title: 'Email',
                  body: 'Broadcasts and replies route through your connected email provider.',
                },
                {
                  icon: Users,
                  title: 'Shared inbox',
                  body: 'Every connected channel lands in one inbox your whole team works from.',
                },
              ].map((item, i) => (
                <li
                  key={item.title}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className="border-border motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 flex items-start gap-3 rounded-lg border p-3 fill-mode-both duration-200 ease-out"
                >
                  <item.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{item.title}</span>
                    <span className="text-muted-foreground text-xs leading-relaxed">
                      {item.body}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 'team' && (
          <>
            <header className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                Invite your team
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Teammates get an email with a join link. You can skip this and
                invite people later from Settings → Members.
              </p>
            </header>
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="invite-email" className="sr-only">
                    Email address
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' &&
                        !e.nativeEvent.isComposing &&
                        e.keyCode !== 229
                      )
                        void sendInvite();
                    }}
                    placeholder="teammate@company.com"
                  />
                </div>
                <Select value={inviteRole} onValueChange={(v) => v && setInviteRole(v)}>
                  <SelectTrigger className="w-28" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  disabled={busy || inviteEmail.trim() === ''}
                  onClick={() => void sendInvite()}
                  className="transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  Invite
                </Button>
              </div>
              {invited.length > 0 && (
                <ul className="flex flex-col gap-1" aria-label="Sent invites">
                  {invited.map((email) => (
                    <li
                      key={email}
                      className="text-muted-foreground motion-safe:animate-in motion-safe:fade-in flex items-center gap-2 text-xs duration-200"
                    >
                      <Check className="size-3 text-primary" aria-hidden />
                      Invite sent to {email}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <footer className="flex items-center justify-between pt-2">
          {step === 'workspace' ? (
            <span />
          ) : (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(STEPS[stepIndex - 1].id);
              }}
            >
              Back
            </Button>
          )}
          {step === 'workspace' && (
            <Button
              disabled={busy || name.trim().length < 2}
              onClick={() => void saveWorkspace()}
              className="transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <>
                  Continue <ArrowRight className="size-4" aria-hidden />
                </>
              )}
            </Button>
          )}
          {step === 'channel' && (
            <Button
              disabled={busy}
              onClick={advance}
              className="transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              Continue <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
          {step === 'team' && (
            <Button
              disabled={busy}
              onClick={() => void finish()}
              className="transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : invited.length > 0 ? (
                'Finish setup'
              ) : (
                'Skip & finish'
              )}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
