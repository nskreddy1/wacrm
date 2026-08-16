'use client';

// ============================================================
// /join/[token] — invitation redemption landing page.
//
// Four UI states driven by:
//   - the peek result (server-validated invite payload), and
//   - whether the visitor is currently authenticated.
//
//   ┌──────────────────────┬───────────────┬─────────────────────────┐
//   │ peek                 │ auth          │ render                   │
//   ├──────────────────────┼───────────────┼─────────────────────────┤
//   │ loading              │ —             │ spinner                  │
//   │ ok:false (any reason)│ —             │ friendly error + signup  │
//   │ ok:true              │ signed out    │ "Sign up" + "Sign in"    │
//   │ ok:true              │ signed in     │ "Accept" button → redeem │
//   └──────────────────────┴───────────────┴─────────────────────────┘
//
// We deliberately do NOT redeem automatically on page load — the
// invitee should confirm what account/role they're accepting.
// Auto-redeem would also race with the signup flow returning to
// this page after email verification. Redemption happens ONLY in
// the POST handler behind the Accept button (ADR-004 F2): a link
// that joins a workspace on GET would be redeemable by anything
// that merely follows links, including a mail client's preview
// fetch or a chat app's URL unfurler.
//
// Accepting is ADDITIVE since ADR-004 Task 3 — the invitee keeps
// every workspace they already had — so there is no longer any
// "you already have an account" refusal, and no dead end telling
// an invited user to sign up with a different email.
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, MailX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'agent' | 'viewer';
  expires_at: string;
  /**
   * The invited address, masked ('al***@example.com').
   *
   * Masked because peek is anonymous — an unmasked address would make
   * every invite link an email-disclosure for anyone it gets forwarded
   * to. Enough for the real recipient to recognise; used for display
   * only, never for the decision.
   *
   * Optional: an older deployment of the RPC omits it.
   */
  invited_email_hint?: string;
  /**
   * Whether the signed-in visitor's email is the invited one. Computed
   * in the database so the plaintext never crosses the wire.
   *
   *   true   — this link is for this person; accepting will work.
   *   false  — signed in as somebody else; redeem WILL refuse.
   *   null   — nobody signed in yet, so there is nothing to compare.
   *
   * `false` and `null` are deliberately distinct: one is a wrong
   * identity to warn about, the other is simply "not yet known".
   */
  invited_email_matches?: boolean | null;
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'used' | 'expired' | 'server_error' | 'rate_limited';
}
type PeekResult = PeekOk | PeekFail;

/**
 * Defensive normalization of whatever the peek endpoint returned.
 * Guards against shapes we didn't anticipate (429 rate-limit body,
 * proxy error pages, partial JSON) — anything unknown becomes a
 * retryable server_error instead of crashing the render on
 * FAIL_COPY[undefined].
 */
function normalizePeek(status: number, body: unknown): PeekResult {
  if (status === 429) return { ok: false, reason: 'rate_limited' };
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.ok === true && typeof b.account_name === 'string') {
      return b as unknown as PeekOk;
    }
    if (
      b.ok === false &&
      typeof b.reason === 'string' &&
      ['not_found', 'used', 'expired', 'server_error'].includes(b.reason)
    ) {
      return b as unknown as PeekFail;
    }
  }
  return { ok: false, reason: 'server_error' };
}

const ROLE_LABEL: Record<PeekOk['role'], string> = {
  admin: 'Admin',
  agent: 'Agent',
  viewer: 'Viewer',
};

/**
 * A refusal from the redeem endpoint that the invitee cannot retry away.
 * Keyed off the endpoint's machine-readable `reason` rather than its
 * message text, so rewording the database's prose cannot change which
 * recovery path the user is offered.
 */
type BlockerReason = 'email_mismatch' | 'email_unverified';

interface AcceptBlocker {
  reason: BlockerReason;
  message: string;
}

const BLOCKER_COPY: Record<
  BlockerReason,
  { title: string; body: string; action: 'switch-account' | 'recheck' }
> = {
  email_mismatch: {
    title: 'Signed in with a different email',
    // The fix is to switch accounts, NOT to create a new one: the invite
    // is bound to a specific address, and signing up again with yet
    // another address would fail the same check.
    body: 'This invitation was sent to a different email address. Sign in with the invited address to accept it — your current workspace stays exactly as it is.',
    action: 'switch-account',
  },
  email_unverified: {
    title: 'Verify your email first',
    body: 'Confirm your email address before joining this workspace. Open the verification link we emailed you, then come back to this page.',
    action: 'recheck',
  },
};

const FAIL_COPY: Record<PeekFail['reason'], { title: string; body: string }> = {
  not_found: {
    title: 'Invite not found',
    body: 'This link doesn’t match a valid invitation. Double-check the URL or ask the person who invited you to send a new one.',
  },
  used: {
    title: 'Invite already used',
    body: 'This invitation has already been accepted. If that wasn’t you, ask the account admin to send a fresh link.',
  },
  expired: {
    title: 'Invite expired',
    body: 'This invitation has expired. Ask the account admin to send a new one — they take a few seconds to generate.',
  },
  server_error: {
    title: 'Something went wrong',
    body: 'We couldn’t verify this invitation right now. Try refreshing the page in a moment.',
  },
  rate_limited: {
    title: 'Too many attempts',
    body: 'This page was refreshed too many times in a short period. Wait a minute, then try again.',
  },
};

/**
 * Shared shell for every state of this page.
 *
 * Deliberately not a Card. This is a single-decision page reached from
 * an email — a bordered box floating on a background adds chrome around
 * a page that has nothing to separate itself from. Dropping it lets the
 * heading and the one button carry the whole screen, and keeps the
 * layout identical across loading / error / accept so nothing shifts as
 * the peek resolves.
 */
function JoinShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
      {children}
    </div>
  );
}

/**
 * The workspace's mark: its initials, derived from the name.
 *
 * An identicon or generated art would be decoration standing in for
 * identity. Initials are the actual identity, and they reassure the
 * invitee that this is the workspace they were told to expect.
 */
function TeamMark({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      aria-hidden
      className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full text-lg font-semibold tracking-tight"
    >
      {initials || '?'}
    </span>
  );
}

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [peek, setPeek] = useState<PeekResult | null>(null);
  // Local auth probe — the AuthProvider lives inside the (dashboard)
  // route group, so it doesn't reach this page. We hit Supabase
  // directly the same way `/login` and `/signup` do.
  const [authedUserId, setAuthedUserId] = useState<string | null | undefined>(
    undefined // undefined = unknown / still loading; null = signed out
  );
  // Shown on the accept button as "Continue as <email>". Naming the
  // identity on the button is the whole safety story of this page: the
  // invite is bound to one address, and someone signed in as the wrong
  // person should see that before they click, not after a refusal.
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  // A refusal that the invitee cannot fix by retrying — they are signed
  // in as the wrong person, or their email is unverified. Shown inline
  // with the one action that actually resolves it.
  //
  // This replaces the old 409 "conflict" dialog. That dialog existed
  // because redeeming used to be refused when the caller's own account
  // held data, and its only advice was "sign out and sign up with a
  // different email" — telling an invited user to abandon their account
  // to accept an invitation. ADR-004 Task 3 made joining additive, so
  // the refusal can no longer happen and the dead end is deleted.
  const [blocker, setBlocker] = useState<AcceptBlocker | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Extracted so the "Try again" button on the server_error card
  // can re-run the same logic without remounting the component.
  const loadPeekAndAuth = useCallback(async () => {
    if (!token) return;
    try {
      const [peekRes, authRes] = await Promise.all([
        fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
          cache: 'no-store',
        }),
        createClient().auth.getUser(),
      ]);
      const peekBody: unknown = await peekRes.json().catch(() => null);
      setPeek(normalizePeek(peekRes.status, peekBody));
      setAuthedUserId(authRes.data.user?.id ?? null);
      setAuthedEmail(authRes.data.user?.email ?? null);
    } catch (err) {
      console.error('[join] peek error:', err);
      setPeek({ ok: false, reason: 'server_error' });
      setAuthedUserId(null);
      setAuthedEmail(null);
    }
  }, [token]);

  // Fetch peek + auth state on mount, through the same callback the
  // "Try again" button uses. This used to be a second inlined copy of
  // the same fetch pair, which is how the two drifted apart — only one
  // of them recorded the signed-in email. One implementation, one
  // behaviour. The peek endpoint is rate-limited per-IP (30/min), so
  // React strict mode's double-mount in dev is harmless.
  useEffect(() => {
    // Wrapped in an async closure so every setState inside lands after
    // an await — i.e. in a later task, not synchronously during the
    // effect — which is both what React wants and what the compiler's
    // set-state-in-effect rule checks for.
    void (async () => {
      await loadPeekAndAuth();
    })();
  }, [loadPeekAndAuth]);

  /**
   * Re-run the check from a button, showing the skeleton while it runs.
   *
   * The state resets live here rather than inside `loadPeekAndAuth`
   * because on mount they are no-ops that only re-render the page — and
   * a synchronous setState inside an effect is exactly the cascading
   * render the compiler's lint rule warns about. Retrying is the one
   * path where clearing back to "checking…" is real feedback.
   */
  const retry = useCallback(() => {
    setPeek(null);
    setAuthedUserId(undefined);
    setBlocker(null);
    void loadPeekAndAuth();
  }, [loadPeekAndAuth]);

  // `accountName` is passed in rather than read from `peek` so the
  // callback needs no `peek` dependency and cannot close over a stale
  // one. The only call site is inside the peek.ok branch, where the
  // name is already narrowed to a string.
  const handleAccept = useCallback(async (accountName: string) => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/redeem`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        // Switch on the endpoint's stable `reason`, never on its prose.
        // These two are unfixable by retrying, so they get a persistent
        // inline panel with the action that resolves them; everything
        // else is transient and a toast is right.
        if (
          payload.reason === 'email_mismatch' ||
          payload.reason === 'email_unverified'
        ) {
          setBlocker({
            reason: payload.reason,
            message: payload.error ?? '',
          });
        } else {
          toast.error(payload.error || 'Failed to accept invitation');
        }
        setAccepting(false);
        return;
      }
      toast.success(`Welcome to ${accountName}`);
      // Full reload (not router.push) so AuthProvider re-fetches the
      // profile with the new active workspace. Joining is additive now,
      // so any workspace the user already had is still theirs and shows
      // up in the switcher.
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[join] redeem error:', err);
      toast.error('Could not reach the server');
      setAccepting(false);
    }
  }, [token]);

  const handleSignOutAndRetry = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      // Hard reload so the new auth state propagates everywhere
      // (middleware, AuthProvider). Preserves the invite token in
      // the URL so the rebuilt page renders the signed-out CTA path.
      window.location.reload();
    } catch (err) {
      console.error('[join] sign-out error:', err);
      toast.error('Could not sign out. Try refreshing the page.');
      setSigningOut(false);
    }
  }, []);

  // ----- Loading state (peek pending OR auth not yet resolved) -----
  if (peek === null || authedUserId === undefined) {
    return (
      <JoinShell>
        {/* Skeleton in the shape of the resolved state — a mark, a
            heading line, a sub-line — so the page settles into place
            instead of swapping a spinner for a different layout. */}
        <span className="bg-muted size-14 animate-pulse rounded-full" />
        <div className="flex w-full flex-col items-center gap-2.5">
          <span className="bg-muted h-6 w-3/4 animate-pulse rounded-md" />
          <span className="bg-muted h-4 w-1/2 animate-pulse rounded-md" />
        </div>
        <span className="bg-muted h-10 w-full animate-pulse rounded-md" />
      </JoinShell>
    );
  }

  // ----- Peek failed -----
  if (!peek.ok) {
    const copy = FAIL_COPY[peek.reason];
    return (
      <JoinShell>
        <span className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
          <MailX className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {copy.title}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {copy.body}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2">
          {/* For server_error the failure is transient — the network
              flapped or the peek endpoint hiccupped. Try-again is
              the right primary action; the "create account" /
              "sign in" links stay as secondary options. Other
              failure reasons (not_found / used / expired) are
              terminal for this token, so no retry — just the
              signup/sign-in escape hatches. */}
          {peek.reason === 'server_error' ? (
            <>
              <Button onClick={retry} className="w-full">
                Try again
              </Button>
              <Link href="/signup" className="w-full">
                <Button variant="ghost" className="w-full">
                  Create a new account instead
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/signup" className="w-full">
                <Button className="w-full">Create a new account instead</Button>
              </Link>
              <Link href="/login" className="w-full">
                <Button variant="ghost" className="w-full">
                  Sign in
                </Button>
              </Link>
            </>
          )}
        </div>
      </JoinShell>
    );
  }

  // ----- Peek OK -----
  // Mark, one sentence, one qualifier. The expiry date used to sit here
  // too, but a date the invitee can do nothing about is noise at the
  // moment of accepting — an expired token already says so on its own
  // screen, which is where that fact is actionable.
  const inviteHeader = (
    <>
      <TeamMark name={peek.account_name} />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          You&apos;ve been invited to{' '}
          <span className="whitespace-nowrap">{peek.account_name}</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Joining as {ROLE_LABEL[peek.role]}
        </p>
        {/* Which address the link is bound to. Redeem accepts only this
            one, so naming it up front is what turns a link that "might
            work" into one the recipient can verify at a glance — and
            tells someone signing up which of their addresses to use.
            Masked, because this renders pre-auth to whoever holds the
            link. */}
        {peek.invited_email_hint ? (
          <p className="text-muted-foreground/80 font-mono text-xs">
            {peek.invited_email_hint}
          </p>
        ) : null}
      </div>
    </>
  );

  // ----- Authed: show Accept button -----
  if (authedUserId) {
    // Peek already told us whether this session is the invited one, so
    // the mismatch can be stated on arrival instead of after a failed
    // attempt. `blocker` (set by an actual refusal) wins, since it
    // reports what the server really said; this only fills the gap
    // before the first click.
    //
    // Same reason code either way, so the wording and the recovery
    // path cannot drift apart between the two moments.
    const preflightMismatch = !blocker && peek.invited_email_matches === false;
    const blockerCopy = blocker
      ? BLOCKER_COPY[blocker.reason]
      : preflightMismatch
        ? BLOCKER_COPY.email_mismatch
        : null;

    // Don't offer an action that is guaranteed to be refused. When we
    // already know the identity is wrong, "Continue as <email>" is a
    // button whose only outcome is an error — the switch-account
    // control inside the notice is the real next step.
    const canAccept = !preflightMismatch;

    return (
      <JoinShell>
        {inviteHeader}
        <div className="flex w-full flex-col gap-3">
          {blockerCopy ? (
              <div
                role="alert"
                className="border-border bg-muted/40 flex flex-col gap-3 rounded-lg border p-4 text-left"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  <div className="flex flex-col gap-1">
                    <p className="text-foreground text-sm font-medium">
                      {blockerCopy.title}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {blockerCopy.body}
                    </p>
                  </div>
                </div>
                {blockerCopy.action === 'switch-account' ? (
                  <Button
                    onClick={handleSignOutAndRetry}
                    disabled={signingOut}
                    variant="outline"
                    className="border-border text-foreground hover:bg-muted w-full"
                  >
                    {signingOut ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Signing out…
                      </>
                    ) : (
                      'Sign in with the invited address'
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={retry}
                    variant="outline"
                    className="border-border text-foreground hover:bg-muted w-full"
                  >
                    I&apos;ve verified — check again
                  </Button>
                )}
              </div>
            ) : null}
            {/* Names the identity being used. "Accept invitation" hid
                the one fact that decides whether this click works —
                which account you are signed in as — behind a refusal
                shown only afterwards. `truncate` because an email can
                be longer than the button. */}
            {canAccept ? (
              <Button
                onClick={() => handleAccept(peek.account_name)}
                disabled={accepting}
                className="w-full"
              >
                {accepting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Joining…
                  </>
                ) : (
                  <span className="truncate">
                    {authedEmail ? `Continue as ${authedEmail}` : 'Continue'}
                  </span>
                )}
              </Button>
            ) : null}
        </div>
      </JoinShell>
    );
  }

  // ----- Not authed: prompt to sign up or sign in -----
  return (
    <JoinShell>
      {inviteHeader}
      <div className="flex w-full flex-col gap-2">
        <Link
          href={`/signup?invite=${encodeURIComponent(token!)}`}
          className="w-full"
        >
          <Button className="w-full">Continue</Button>
        </Link>
        <Link
          href={`/login?invite=${encodeURIComponent(token!)}`}
          className="w-full"
        >
          <Button variant="ghost" className="w-full">
            I already have an account
          </Button>
        </Link>
      </div>
    </JoinShell>
  );
}
