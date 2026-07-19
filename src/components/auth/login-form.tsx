"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  inviteToken: string | null;
  /** Label for the submit button */
  submitLabel?: string;
};

export function LoginForm({ inviteToken, submitLabel = "Sign in" }: LoginFormProps) {
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
    <form onSubmit={handleLogin}>
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
          {loading ? "Signing in..." : submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
