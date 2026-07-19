import Link from "next/link";
import { AxonMark } from "@/components/brand/axon-logo";

type AuthShellProps = {
  children: React.ReactNode;
  promoTitle?: React.ReactNode;
  promoDescription?: string;
};

/**
 * Shared split layout for all auth pages: fixed premium-indigo brand
 * panel on the left (greeting + arcs), form column on the right.
 * The panel color is intentionally decoupled from the in-app accent
 * theme — see `.auth-panel` in globals.css.
 */
export function AuthShell({
  children,
  promoTitle = (
    <>
      Hello,
      <br />
      Axon!
    </>
  ),
  promoDescription = "Turn every conversation into revenue. WhatsApp, SMS, and email in one shared inbox — with pipelines and automated follow-ups built in.",
}: AuthShellProps) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section
        aria-label="About Axon"
        className="auth-panel relative hidden overflow-hidden lg:flex lg:flex-col"
      >
        {/* Concentric arc decoration — depth without noise */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[420, 620, 820, 1020].map((size, index) => (
            <div
              key={size}
              className="auth-panel-ring absolute rounded-full"
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
          <div
            className="flex flex-col gap-6 pt-16"
            style={{ "--stagger-index": 0 } as React.CSSProperties}
          >
            <h2 className="max-w-xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight xl:text-6xl">
              {promoTitle}
            </h2>
            <p className="max-w-md text-pretty text-lg leading-relaxed opacity-85">
              {promoDescription}
            </p>
          </div>

          <p
            className="text-sm opacity-70"
            style={{ "--stagger-index": 1 } as React.CSSProperties}
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
            className="flex w-fit items-center gap-2.5 text-lg font-bold tracking-tight text-foreground"
            aria-label="Axon home"
          >
            <AxonMark size={26} variant="mono" className="text-foreground" />
            Axon
          </Link>
        </header>

        <div className="flex flex-1 items-center py-12">
          <div className="auth-stagger w-full max-w-md">{children}</div>
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
