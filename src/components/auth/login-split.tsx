"use client";

import Link from "next/link";
import { UsersRound } from "lucide-react";
import { AxonMark } from "@/components/brand/axon-logo";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { LoginForm } from "@/components/auth/login-form";
import { FieldSeparator } from "@/components/ui/field";

type LoginSplitProps = {
  inviteToken: string | null;
};

export function LoginSplit({ inviteToken }: LoginSplitProps) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section
        aria-label="About Axon"
        className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col"
      >
        {/* Concentric ring decoration — depth without noise */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[420, 620, 820, 1020].map((size, index) => (
            <div
              key={size}
              className="absolute rounded-full border border-primary-foreground/10"
              style={{
                width: size,
                height: size,
                right: -size / 3,
                top: -size / 4,
                opacity: 1 - index * 0.18,
              }}
            />
          ))}
        </div>

        <div className="auth-stagger relative flex flex-1 flex-col justify-between gap-10 p-12 xl:p-16">
          <div style={{ "--stagger-index": 0 } as React.CSSProperties}>
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary-foreground/15">
              <AxonMark size={28} variant="mono" aria-hidden="true" />
            </span>
          </div>

          <div
            className="flex flex-col gap-6"
            style={{ "--stagger-index": 1 } as React.CSSProperties}
          >
            <h2 className="max-w-xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight xl:text-6xl">
              Hello,
              <br />
              Axon!
            </h2>
            <p className="max-w-md text-pretty text-lg leading-relaxed text-primary-foreground/85">
              Turn every conversation into revenue. WhatsApp, SMS, and email in one shared
              inbox — with pipelines and automated follow-ups built in.
            </p>
          </div>

          <p
            className="text-sm text-primary-foreground/70"
            style={{ "--stagger-index": 2 } as React.CSSProperties}
          >
            &copy; {new Date().getFullYear()} Axon. All rights reserved.
          </p>
        </div>
      </section>

      {/* Form panel */}
      <section className="flex min-h-screen flex-col px-6 py-8 sm:px-12 xl:px-20">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex w-fit items-center gap-2.5 font-semibold tracking-tight text-foreground"
            aria-label="Axon home"
          >
            <AxonMark size={26} variant="mono" className="text-foreground" />
            Axon
          </Link>
          <a
            href="mailto:support@axon.app"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Contact support
          </a>
        </header>

        <div className="flex flex-1 items-center py-12">
          <div className="auth-stagger flex w-full max-w-md flex-col gap-8">
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
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <p className="lg:hidden">&copy; {new Date().getFullYear()} Axon. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/" className="transition-colors hover:text-foreground">
              Terms
            </Link>
          </div>
        </footer>
      </section>
    </main>
  );
}
