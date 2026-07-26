import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page not found',
};

/**
 * Global 404. Without this file Next.js serves its unstyled default,
 * which looks like a crash rather than a handled state — the checklist's
 * "check your 404 page" item.
 *
 * Deliberately minimal and self-contained: a 404 can be reached while
 * unauthenticated (or from a stale bookmark), so it must not depend on
 * the dashboard shell, sidebar, or any tenant data lookup.
 */
export default function NotFound() {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-muted-foreground font-mono text-sm tracking-widest uppercase">
          Error 404
        </p>
        <h1 className="font-serif text-4xl leading-tight text-balance sm:text-5xl">
          We couldn&apos;t find that page
        </h1>
        <p className="text-muted-foreground max-w-md text-base leading-relaxed text-pretty">
          The link may be out of date, or the record it pointed to was moved
          or deleted.
        </p>
      </div>
      {/* Styled anchors rather than <Button><Link/></Button>: this
          project's Button has no `asChild`, and nesting the two yields a
          button wrapping a link — two focus stops for one action, which
          screen readers announce twice. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/dashboard"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Back to dashboard
        </Link>
        <Link
          href="/support"
          className="border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Contact support
        </Link>
      </div>
    </main>
  );
}
