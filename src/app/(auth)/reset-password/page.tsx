"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { routes } from "@/lib/routing/routes";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      toast.success("Password updated");
      router.replace(routes.app.dashboard);
    } catch {
      setError("We could not update your password. Open a fresh reset link and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      promoTitle="Secure your workspace and get back to growing"
      promoDescription="Choose a strong new password, then return to the conversations and opportunities that matter."
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Secure account update</p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Create a new password</h1>
          <p className="text-pretty leading-relaxed text-muted-foreground">Use at least eight characters and make it unique to your WACRM account.</p>
        </div>

        <form onSubmit={submit}>
          <FieldGroup>
            {error && <FieldError>{error}</FieldError>}
            <Field>
              <FieldLabel htmlFor="password">New password</FieldLabel>
              <Input id="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(error)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmation">Confirm password</FieldLabel>
              <Input id="confirmation" type="password" autoComplete="new-password" placeholder="Repeat your password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-invalid={Boolean(error)} />
            </Field>
            <Button type="submit" disabled={loading} className="w-full">{loading ? "Updating password..." : "Update password"}</Button>
          </FieldGroup>
        </form>
      </div>
    </AuthShell>
  );
}
