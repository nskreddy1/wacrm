'use client';

import Link from 'next/link';
import { UsersRound } from 'lucide-react';
import { GoogleAuthButton } from '@/features/auth/components/google-auth-button';
import { LoginForm } from '@/features/auth/components/login-form';

type LoginSplitProps = {
  inviteToken: string | null;
};

export function LoginSplit({ inviteToken }: LoginSplitProps) {
  return (
    <div className="flex w-full flex-col gap-8">
      <div
        className="flex flex-col gap-3"
        style={{ '--stagger-index': 0 } as React.CSSProperties}
      >
        {inviteToken && (
          <p className="border-primary/30 bg-primary-soft text-primary flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
            <UsersRound className="size-3.5" aria-hidden="true" />
            Team invitation
          </p>
        )}
        <h1 className="text-foreground text-4xl font-semibold tracking-tight text-balance">
          Welcome back!
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
          Don&apos;t have an account?{' '}
          <Link
            href={
              inviteToken
                ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                : '/signup'
            }
            className="text-primary hover:text-primary-hover font-medium underline underline-offset-4 transition-colors"
          >
            Create a new account now
          </Link>
          , it&apos;s free and takes less than a minute.
        </p>
      </div>

      <div
        className="flex flex-col gap-4"
        style={{ '--stagger-index': 1 } as React.CSSProperties}
      >
        {/* Order mirrors the reference design: primary sign-in first,
              Google directly under it, forgot-password link last. */}
        <LoginForm inviteToken={inviteToken} submitLabel="Sign in now" />
        <GoogleAuthButton
          inviteToken={inviteToken}
          label="Sign in with Google"
        />
        <p className="text-muted-foreground pt-2 text-center text-sm">
          Forgot password?{' '}
          <Link
            href="/forgot-password"
            className="text-foreground hover:text-primary font-semibold underline underline-offset-4 transition-colors"
          >
            Click here
          </Link>
        </p>
      </div>
    </div>
  );
}
