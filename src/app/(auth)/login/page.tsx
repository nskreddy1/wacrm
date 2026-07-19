"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldCheck, UsersRound } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const hasSupabaseConfig = Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      );

      if (hasSupabaseConfig) {
        const { error: signInError } = await createClient().auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInError) {
          setError(signInError.message);
          return;
        }
      } else {
        const response = await fetch("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          setError(body?.message ?? "Unable to sign in. Check your email and password.");
          return;
        }
      }

      router.push(inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/dashboard");
    } catch {
      setError("Something went wrong while signing in. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      promoTitle="Welcome back to your customer command center"
      promoDescription="Pick up every conversation, deal, and follow-up exactly where your team left it."
    >
      <div className="auth-stagger flex flex-col gap-8">
        <div
          className="flex flex-col gap-2.5"
          style={{ "--stagger-index": 0 } as React.CSSProperties}
        >
          {inviteToken && (
            <p className="flex w-fit items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
              <UsersRound className="size-3.5" aria-hidden="true" />
              Team invitation
            </p>
          )}
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground">
            {inviteToken ? "Sign in to join your team" : "Sign in to WACRM"}
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Enter your work email to access conversations, pipelines, and follow-ups.
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          style={{ "--stagger-index": 1 } as React.CSSProperties}
        >
          <FieldGroup>
            {error && (
              <div className="auth-shake" role="alert">
                <FieldError>{error}</FieldError>
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="email">Work email</FieldLabel>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                aria-invalid={Boolean(error)}
              />
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-primary transition-colors hover:text-primary-hover"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  aria-invalid={Boolean(error)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </Field>
            <Button
              type="submit"
              disabled={loading}
              className="w-full transition-transform duration-150 ease-out active:scale-[0.98]"
            >
              {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </FieldGroup>
        </form>

        <div
          className="flex flex-col gap-5"
          style={{ "--stagger-index": 2 } as React.CSSProperties}
        >
          <p className="text-sm text-muted-foreground">
            New to WACRM?{" "}
            <Link
              href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"}
              className="font-medium text-primary transition-colors hover:text-primary-hover"
            >
              Create an account
            </Link>
          </p>
          <p className="flex items-center gap-2 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            Your session is protected with encrypted authentication and role-based access.
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
