"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, MessageSquareText, UsersRound } from "lucide-react";
import { SignupPromoPanel } from "@/components/auth/signup-promo-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const loginHref = inviteToken
    ? `/login?invite=${encodeURIComponent(inviteToken)}`
    : "/login";

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const normalizedName = fullName.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedName.length < 2) {
      setError("Enter your full name to continue.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
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
        setError("We could not create your account. Please try again.");
        return;
      }

      setEmail(normalizedEmail);
      setSuccess(true);
    } catch {
      setError("Something went wrong while creating your account. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-muted p-3 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-7xl overflow-hidden rounded-2xl bg-background p-4 shadow-xl sm:min-h-[calc(100vh-3rem)] sm:p-6 lg:grid-cols-[minmax(26rem,0.9fr)_minmax(32rem,1.1fr)] lg:gap-6">
        <section className="flex min-h-full flex-col px-2 py-2 sm:px-8 lg:px-10">
          <Link
            href="/"
            className="flex w-fit items-center gap-2 font-semibold tracking-tight text-foreground"
            aria-label="WACRM home"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquareText aria-hidden="true" />
            </span>
            WACRM
          </Link>

          <div className="flex flex-1 items-center justify-center py-10">
            {success ? (
              <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CheckCircle2 aria-hidden="true" />
                </span>
                <div className="flex flex-col gap-2">
                  <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground">
                    Check your email
                  </h1>
                  <p className="text-pretty leading-relaxed text-muted-foreground">
                    We sent a confirmation link to <strong className="font-medium text-foreground">{email}</strong>.
                    Verify your email to finish creating your WACRM account.
                  </p>
                </div>
                <Button variant="outline" className="w-full" render={<Link href={loginHref} />}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <div className="w-full max-w-md">
                <div className="mb-7 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary lg:hidden">
                    {inviteToken && <UsersRound aria-hidden="true" />}
                    {inviteToken ? "Team invitation" : "Your customer workspace"}
                  </div>
                  <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                    {inviteToken ? "Create your account & join" : "Create your account"}
                  </h1>
                  <p className="text-pretty leading-relaxed text-muted-foreground">
                    {inviteToken
                      ? "Verify your email, then accept your invitation to join the team."
                      : "Start organizing every WhatsApp relationship in one place."}
                  </p>
                </div>

                <FieldGroup>
                  <Button type="button" variant="outline" className="w-full" aria-disabled="true">
                    <span data-icon="inline-start" className="font-semibold" aria-hidden="true">G</span>
                    Continue with Google
                  </Button>

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
                        />
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
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
                        />
                      </Field>
                    </div>

                    <Field orientation="horizontal">
                      <Checkbox id="terms" aria-describedby="terms-label" />
                      <FieldLabel id="terms-label" htmlFor="terms" className="text-sm font-normal text-muted-foreground">
                        I agree to the Terms, Privacy Policy, and Fees.
                      </FieldLabel>
                    </Field>

                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? "Creating account..." : "Create account"}
                    </Button>
                  </form>
                </FieldGroup>

                <p className="mt-5 text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link href={loginHref} className="font-medium text-primary hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>
            )}
          </div>
        </section>

        <SignupPromoPanel />
      </div>
    </main>
  );
}
