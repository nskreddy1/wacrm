"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  const [loading, setLoading] = useState(false);

  function showLoginError(message: string) {
    toast.error("Sign-in failed", {
      description: message,
    });
    setLoading(false);
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          showLoginError(signInError.message);
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
          showLoginError(body?.message ?? "Unable to sign in. Check your email and password.");
          return;
        }
      }

      const destination = inviteToken
        ? `/join/${encodeURIComponent(inviteToken)}`
        : "/dashboard";

      // Authentication is a server boundary: use a document navigation so
      // Next.js proxy receives the freshly-written Supabase session cookie on
      // the very next request. A client router transition can reuse the auth
      // route tree/cache and appear stuck while the protected route resolves.
      window.location.assign(destination);
    } catch {
      showLoginError("Something went wrong while signing in. Try again.");
    }
  }

  return (
    <form onSubmit={handleLogin}>
      <FieldGroup>
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
            variant="underline"
            size="lg"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              variant="underline"
              size="lg"
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
        <Button type="submit" disabled={loading} size="xl" className="w-full">
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {loading ? "Signing in..." : submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
