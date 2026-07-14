"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { UsersRound } from "lucide-react";
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
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          {inviteToken && (
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <UsersRound aria-hidden="true" /> Team invitation
            </p>
          )}
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {inviteToken ? "Sign in to join your team" : "Welcome back"}
          </h1>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            Sign in to manage customer conversations and keep your pipeline moving.
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <FieldGroup>
            {error && <FieldError>{error}</FieldError>}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required aria-invalid={Boolean(error)} />
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">Forgot password?</Link>
              </div>
              <Input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required aria-invalid={Boolean(error)} />
            </Field>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </FieldGroup>
        </form>

        <p className="text-sm text-muted-foreground">
          New to WACRM?{" "}
          <Link href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"} className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
