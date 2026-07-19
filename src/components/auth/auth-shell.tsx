import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";

type AuthShellProps = {
  children: React.ReactNode;
  promoTitle?: string;
  promoDescription?: string;
};

export function AuthShell({ children, promoTitle, promoDescription }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen max-w-[110rem] lg:grid-cols-[minmax(28rem,1fr)_minmax(30rem,1.05fr)] lg:gap-6 lg:p-6">
        {/* Form column */}
        <section className="flex min-h-full flex-col px-6 py-6 sm:px-12 lg:px-14 lg:py-8">
          <header className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="flex w-fit items-center gap-2.5 font-semibold tracking-tight text-foreground"
              aria-label="WACRM home"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <MessageSquareText className="size-4" aria-hidden="true" />
              </span>
              WACRM
            </Link>
            <a
              href="mailto:support@wacrm.app"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Contact support
            </a>
          </header>

          <div className="flex flex-1 items-center justify-center py-12">
            <div className="w-full max-w-md">{children}</div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} WACRM. All rights reserved.</p>
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

        <AuthBrandPanel title={promoTitle} description={promoDescription} />
      </div>
    </main>
  );
}
