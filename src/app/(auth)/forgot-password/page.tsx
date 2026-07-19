"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/auth/callback?purpose=recovery` },
      );
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSuccess(true);
    } catch {
      setError("We could not send the reset link. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {success ? (
        <div className="auth-rise-block flex flex-col items-center gap-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground">Check your email</h1>
            <p className="text-pretty leading-relaxed text-muted-foreground">
              If an account exists for <strong className="font-medium text-foreground">{email}</strong>, a secure reset link is on its way.
            </p>
          </div>
          <Button variant="outline" className="w-full" render={<Link href="/login" />}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back to sign in
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-primary">Account recovery</p>
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Reset your password</h1>
            <p className="text-pretty leading-relaxed text-muted-foreground">Enter your account email and we&apos;ll send you a secure reset link.</p>
          </div>

          <form onSubmit={handleReset}>
            <FieldGroup>
              {error && <FieldError>{error}</FieldError>}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required aria-invalid={Boolean(error)} />
              </Field>
              <Button type="submit" disabled={loading} className="w-full">{loading ? "Sending link..." : "Send reset link"}</Button>
            </FieldGroup>
          </form>

          <Link href="/login" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" /> Back to sign in
          </Link>
        </div>
      )}
    </>
  );
}
