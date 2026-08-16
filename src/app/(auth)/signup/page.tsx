'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, UsersRound } from 'lucide-react';
import { GoogleAuthButton } from '@/features/auth/components/google-auth-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const loginHref = inviteToken
    ? `/login?invite=${encodeURIComponent(inviteToken)}`
    : '/login';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const normalizedName = fullName.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedName.length < 2) {
      setError('Enter your full name to continue.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      // When following an invite, verify the address BEFORE creating
      // anything. Supabase's signUp is the point of no return: the
      // handle_new_user trigger runs inside it, and on a mismatch it
      // finds no invitation for the address and bootstraps a brand new
      // workspace instead. The user then lands on /join, is told
      // "Signed in with a different email", and is stuck holding an
      // account they did not want and cannot use to accept.
      //
      // The server compares against the invited address and returns
      // only yes/no, so the address is never exposed to the browser.
      if (inviteToken) {
        const res = await fetch(
          `/api/invitations/${encodeURIComponent(inviteToken)}/check-email`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: normalizedEmail }),
            cache: 'no-store',
          }
        );
        const verdict = (await res.json().catch(() => null)) as {
          matches?: boolean;
          reason?: string | null;
        } | null;

        // Treat an unreadable response as "proceed": redeem still
        // enforces the address later, so a network blip must not lock a
        // legitimate invitee out of signing up entirely.
        if (verdict && verdict.matches === false) {
          setError(
            verdict.reason === 'expired'
              ? 'This invitation has expired. Ask your admin to send a new one.'
              : verdict.reason === 'already_accepted'
                ? 'This invitation has already been accepted. Sign in instead.'
                : 'This invitation was sent to a different email address. Enter the address it was sent to, or sign up without the invitation link.'
          );
          return;
        }
      }

      const supabase = createClient();
      const emailRedirectTo = inviteToken
        ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
        : undefined;

      const { data, error: signupError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: { full_name: normalizedName },
          ...(emailRedirectTo ? { emailRedirectTo } : {}),
        },
      });

      if (signupError) {
        setError(signupError.message);
        return;
      }

      if (!data.user) {
        setError('We could not create your account. Please try again.');
        return;
      }

      setEmail(normalizedEmail);
      setSuccess(true);
    } catch {
      setError('Something went wrong while creating your account. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {success ? (
        <div className="auth-rise-block flex w-full max-w-md flex-col items-center gap-6 text-center">
          <span className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
            <CheckCircle2 aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance">
              Check your email
            </h1>
            <p className="text-muted-foreground leading-relaxed text-pretty">
              We sent a confirmation link to{' '}
              <strong className="text-foreground font-medium">{email}</strong>.
              Verify your email to finish creating your Axon account.
            </p>
          </div>
          {/* nativeButton={false} because `render` swaps in a Link,
              i.e. an <a>. Base UI defaults to expecting a real
              <button> and warns that replacing it drops native button
              semantics — but this control genuinely IS navigation, so
              an anchor is the correct element (middle-click, "open in
              new tab", and the link's own keyboard behaviour all work).
              The flag tells Base UI the substitution is intentional. */}
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link href={loginHref} />}
          >
            Back to sign in
          </Button>
        </div>
      ) : (
        <div className="w-full max-w-md">
          <div className="mb-7 flex flex-col gap-2">
            <div className="text-primary flex items-center gap-2 text-sm font-medium lg:hidden">
              {inviteToken && <UsersRound aria-hidden="true" />}
              {inviteToken ? 'Team invitation' : 'Your customer workspace'}
            </div>
            <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {inviteToken
                ? 'Create your account & join'
                : 'Create your account'}
            </h1>
            <p className="text-muted-foreground leading-relaxed text-pretty">
              {inviteToken
                ? 'Verify your email, then accept your invitation to join the team.'
                : 'Start organizing every customer conversation — WhatsApp, SMS, and email — in one place.'}
            </p>
          </div>

          <FieldGroup>
            <GoogleAuthButton
              inviteToken={inviteToken}
              label="Continue with Google"
            />

            {/* The email/password path is pre-verified against the
                invitation before any account is created, but Google's
                is not verifiable up front: the chosen address is only
                known after the redirect, by which point the account
                exists. So the one thing we can do here is make the
                requirement explicit before they pick an account. */}
            {inviteToken && (
              <p className="text-muted-foreground text-center text-xs">
                Choose the Google account for the address the invitation
                was sent to.
              </p>
            )}

            <FieldSeparator>or</FieldSeparator>

            <form onSubmit={handleSignup} className="contents">
              {error && <FieldError>{error}</FieldError>}

              <Field>
                <FieldLabel htmlFor="fullName">Full name</FieldLabel>
                <Input
                  id="fullName"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Enter your name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  aria-invalid={Boolean(error)}
                  variant="underline"
                  size="lg"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  aria-invalid={Boolean(error)}
                  variant="underline"
                  size="lg"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={6}
                    required
                    aria-invalid={Boolean(error)}
                    variant="underline"
                    size="lg"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="confirmPassword">
                    Confirm password
                  </FieldLabel>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={6}
                    required
                    aria-invalid={Boolean(error)}
                    variant="underline"
                    size="lg"
                  />
                </Field>
              </div>

              <Field orientation="horizontal">
                <Checkbox id="terms" aria-describedby="terms-label" />
                <FieldLabel
                  id="terms-label"
                  htmlFor="terms"
                  className="text-muted-foreground text-sm font-normal"
                >
                  I agree to the Terms, Privacy Policy, and Fees.
                </FieldLabel>
              </Field>

              <Button
                type="submit"
                disabled={loading}
                size="xl"
                className="w-full"
              >
                {loading ? 'Creating account...' : 'Create account'}
              </Button>
            </form>
          </FieldGroup>

          <p className="text-muted-foreground mt-5 text-sm">
            Already have an account?{' '}
            <Link
              href={loginHref}
              className="text-primary font-medium hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
