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

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  MailX,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';

interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'agent' | 'viewer';
  expires_at: string;
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
    setPeek(null);
    setAuthedUserId(undefined);
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
    } catch (err) {
      console.error('[join] peek error:', err);
      setPeek({ ok: false, reason: 'server_error' });
      setAuthedUserId(null);
    }
  }, [token]);

  // Fetch peek + auth state on mount. The peek endpoint is
  // rate-limited per-IP (30/min) so double-mounting in React 19
  // strict mode dev is harmless. We also use the `cancelled` flag
  // to drop setState calls if the component unmounts mid-fetch.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [peekRes, authRes] = await Promise.all([
          fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
            cache: 'no-store',
          }),
          createClient().auth.getUser(),
        ]);
        const peekBody: unknown = await peekRes.json().catch(() => null);
        if (cancelled) return;
        setPeek(normalizePeek(peekRes.status, peekBody));
        setAuthedUserId(authRes.data.user?.id ?? null);
      } catch (err) {
        console.error('[join] peek error:', err);
        if (cancelled) return;
        setPeek({ ok: false, reason: 'server_error' });
        setAuthedUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
      <Card className="border-border bg-card w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
          <p className="text-muted-foreground text-sm">Verifying invitation…</p>
        </CardContent>
      </Card>
    );
  }

  // ----- Peek failed -----
  if (!peek.ok) {
    const copy = FAIL_COPY[peek.reason];
    return (
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <MailX className="h-6 w-6 text-red-400" />
          </div>
          <CardTitle className="text-foreground text-xl">
            {copy.title}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {copy.body}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* For server_error the failure is transient — the network
              flapped or the peek endpoint hiccupped. Try-again is
              the right primary action; the "create account" /
              "sign in" links stay as secondary options. Other
              failure reasons (not_found / used / expired) are
              terminal for this token, so no retry — just the
              signup/sign-in escape hatches. */}
          {peek.reason === 'server_error' ? (
            <>
              <Button
                onClick={loadPeekAndAuth}
                className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
              >
                Try again
              </Button>
              <Link href="/signup">
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted hover:text-foreground w-full"
                >
                  Create a new account instead
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/signup">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 w-full">
                  Create a new account instead
                </Button>
              </Link>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted hover:text-foreground w-full"
                >
                  Sign in
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // ----- Peek OK -----
  const inviteHeader = (
    <CardHeader className="items-center text-center">
      <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
        <UsersRound className="text-primary h-6 w-6" />
      </div>
      <CardTitle className="text-foreground text-xl">
        You&apos;re invited to{' '}
        <span className="text-primary">{peek.account_name}</span>
      </CardTitle>
      <CardDescription className="text-muted-foreground">
        You&apos;ll join as{' '}
        <span className="text-foreground inline-flex items-center gap-1">
          <ShieldCheck className="text-primary size-3.5" />
          {ROLE_LABEL[peek.role]}
        </span>
        . Link valid until{' '}
        {new Date(peek.expires_at).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
        .
      </CardDescription>
    </CardHeader>
  );

  // ----- Authed: show Accept button -----
  if (authedUserId) {
    const blockerCopy = blocker ? BLOCKER_COPY[blocker.reason] : null;

    return (
      <>
        <Card className="border-border bg-card w-full max-w-md">
          {inviteHeader}
          <CardContent className="flex flex-col gap-3">
            {blockerCopy ? (
              <div
                role="alert"
                className="border-border bg-muted/40 flex flex-col gap-3 rounded-lg border p-4"
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
                    onClick={loadPeekAndAuth}
                    variant="outline"
                    className="border-border text-foreground hover:bg-muted w-full"
                  >
                    I&apos;ve verified — check again
                  </Button>
                )}
              </div>
            ) : null}
            <Button
              onClick={() => handleAccept(peek.account_name)}
              disabled={accepting}
              className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
            >
              {accepting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Accepting…
                </>
              ) : (
                <>
                  <CheckCircle className="size-4" />
                  Accept invitation
                </>
              )}
            </Button>
            {/* Honest about what accepting does. The old copy promised
                the user's "empty personal account will be cleaned up",
                which was true when joining MOVED the account and
                deleted the old one. Since ADR-004 Task 3 joining is
                additive: nothing is deleted, and both workspaces stay
                available in the switcher. */}
            <p className="text-muted-foreground text-center text-xs">
              You&apos;ll switch to{' '}
              <span className="text-foreground">{peek.account_name}</span>. Any
              workspace you already have stays yours — you can switch back
              anytime.
            </p>
          </CardContent>
        </Card>

      </>
    );
  }

  // ----- Not authed: prompt to sign up or sign in -----
  return (
    <Card className="border-border bg-card w-full max-w-md">
      {inviteHeader}
      <CardContent className="flex flex-col gap-2">
        <Link href={`/signup?invite=${encodeURIComponent(token!)}`}>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 w-full">
            Create account &amp; join
          </Button>
        </Link>
        <Link href={`/login?invite=${encodeURIComponent(token!)}`}>
          <Button
            variant="outline"
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground w-full"
          >
            I already have an account
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
