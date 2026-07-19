"use client";

import Link from "next/link";
import { UsersRound } from "lucide-react";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { LoginForm } from "@/components/auth/login-form";
import { FieldSeparator } from "@/components/ui/field";

type LoginSplitProps = {
  inviteToken: string | null;
};

export function LoginSplit({ inviteToken }: LoginSplitProps) {
  return (
    <div className="flex w-full flex-col gap-8">
        <div
          className="flex flex-col gap-3"
          style={{ "--stagger-index": 0 } as React.CSSProperties}
        >
          {inviteToken && (
            <p className="flex w-fit items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
              <UsersRound className="size-3.5" aria-hidden="true" />
              Team invitation
            </p>
          )}
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground">
            Welcome back!
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href={
                inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"
              }
              className="font-medium text-primary underline underline-offset-4 transition-colors hover:text-primary-hover"
            >
              Create a new account now
            </Link>
            , it&apos;s free and takes less than a minute.
          </p>
        </div>

        <div
          className="flex flex-col gap-5"
          style={{ "--stagger-index": 1 } as React.CSSProperties}
        >
          <GoogleAuthButton inviteToken={inviteToken} label="Sign in with Google" />
          <FieldSeparator>or continue with email</FieldSeparator>
          <LoginForm inviteToken={inviteToken} submitLabel="Sign in now" />
        </div>
    </div>
  );
}
