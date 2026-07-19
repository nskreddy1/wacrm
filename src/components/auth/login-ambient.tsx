"use client";

import Link from "next/link";
import {
  BadgeDollarSign,
  CheckCheck,
  MessageCircleMore,
  MessageSquareText,
  PhoneCall,
  Trophy,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

type FloatingCard = {
  icon: React.ElementType;
  title: string;
  meta?: string;
  tone?: "default" | "primary";
  /** absolute position classes */
  position: string;
  tilt: number;
  /** hide on smaller screens when true */
  desktopOnly?: boolean;
};

const CARDS: FloatingCard[] = [
  {
    icon: MessageCircleMore,
    title: "Sofia: Can you send pricing?",
    meta: "09:41",
    position: "left-[-1.5rem] top-[12%] sm:left-6",
    tilt: -6,
  },
  {
    icon: CheckCheck,
    title: "Follow-up delivered",
    meta: "09:52",
    tone: "primary",
    position: "left-[4%] top-[38%]",
    tilt: 4,
    desktopOnly: true,
  },
  {
    icon: BadgeDollarSign,
    title: "Acme Corp — $12,400",
    meta: "Negotiation",
    position: "bottom-[22%] left-[-1rem] sm:left-[7%]",
    tilt: -3,
  },
  {
    icon: PhoneCall,
    title: "Call Daniel back",
    meta: "15:00",
    position: "bottom-[6%] left-[22%]",
    tilt: 5,
    desktopOnly: true,
  },
  {
    icon: UserRoundPlus,
    title: "New lead from WhatsApp",
    meta: "Just now",
    position: "right-[-1.5rem] top-[10%] sm:right-8",
    tilt: 7,
  },
  {
    icon: UsersRound,
    title: "Assigned to Priya",
    meta: "Inbox · Sales",
    position: "right-[3%] top-[40%]",
    tilt: -5,
    desktopOnly: true,
  },
  {
    icon: Trophy,
    title: "Deal moved to Won",
    meta: "$8,200",
    tone: "primary",
    position: "bottom-[20%] right-[-1rem] sm:right-[6%]",
    tilt: 4,
  },
  {
    icon: MessageCircleMore,
    title: "3 unread conversations",
    meta: "Support inbox",
    position: "bottom-[5%] right-[24%]",
    tilt: -4,
    desktopOnly: true,
  },
];

type LoginAmbientProps = {
  inviteToken: string | null;
};

export function LoginAmbient({ inviteToken }: LoginAmbientProps) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Scattered workspace cards — decorative, like notes on a desk */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
        {CARDS.map((card, index) => (
          <div
            key={card.title}
            className={`login-card-in absolute ${card.position} ${
              card.desktopOnly ? "hidden xl:block" : "hidden sm:block"
            }`}
            style={
              {
                "--card-index": index,
                "--card-tilt": `${card.tilt}deg`,
              } as React.CSSProperties
            }
          >
            <div
              className={`login-card-float flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-sm backdrop-blur-sm ${
                card.tone === "primary"
                  ? "border-primary/30 bg-primary-soft text-foreground"
                  : "border-border bg-card/90 text-card-foreground"
              }`}
            >
              <card.icon
                className={`size-4 shrink-0 ${
                  card.tone === "primary" ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <div className="flex flex-col">
                <span className="whitespace-nowrap text-xs font-medium leading-snug">
                  {card.title}
                </span>
                {card.meta && (
                  <span className="whitespace-nowrap text-[0.6875rem] leading-snug text-muted-foreground">
                    {card.meta}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Soft vignette so edge cards recede behind the center content */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 55% at 50% 48%, var(--background) 35%, transparent 100%)",
        }}
      />

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-16">
        <div className="auth-stagger flex w-full max-w-sm flex-col items-center gap-8">
          <div
            className="flex flex-col items-center gap-5 text-center"
            style={{ "--stagger-index": 0 } as React.CSSProperties}
          >
            <Link
              href="/"
              aria-label="WACRM home"
              className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              <MessageSquareText className="size-5" aria-hidden="true" />
            </Link>
            {inviteToken && (
              <p className="flex w-fit items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
                <UsersRound className="size-3.5" aria-hidden="true" />
                Team invitation
              </p>
            )}
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-muted-foreground">
              Every conversation, deal, and{" "}
              <span className="whitespace-nowrap">follow-up.</span>{" "}
              <span className="text-foreground">All in one place.</span>
            </h1>
          </div>

          <div className="w-full" style={{ "--stagger-index": 1 } as React.CSSProperties}>
            <LoginForm inviteToken={inviteToken} submitLabel="Continue" />
          </div>

          <div
            className="flex flex-col items-center gap-4 text-center"
            style={{ "--stagger-index": 2 } as React.CSSProperties}
          >
            <p className="text-sm text-muted-foreground">
              New to WACRM?{" "}
              <Link
                href={
                  inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"
                }
                className="font-medium text-primary transition-colors hover:text-primary-hover"
              >
                Create an account
              </Link>
            </p>
            <p className="max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground/80">
              By continuing, you acknowledge that you have read and agree to WACRM&apos;s Terms
              &amp; Conditions and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
