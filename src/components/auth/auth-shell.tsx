"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquareText, PanelsTopLeft, Sparkles } from "lucide-react";
import { SignupPromoPanel } from "@/components/auth/signup-promo-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type SurfaceStyle = "glass" | "solid";

type AuthShellProps = {
  children: React.ReactNode;
  promoTitle?: string;
  promoDescription?: string;
};

const STORAGE_KEY = "wacrm-auth-surface";

export function AuthShell({
  children,
  promoTitle,
  promoDescription,
}: AuthShellProps) {
  const [surface, setSurface] = useState<SurfaceStyle>(() => {
    if (typeof window === "undefined") return "glass";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "solid" ? "solid" : "glass";
  });

  function updateSurface(value: string) {
    if (value !== "glass" && value !== "solid") return;
    setSurface(value);
    window.localStorage.setItem(STORAGE_KEY, value);
  }

  return (
    <main className="min-h-screen bg-muted p-3 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-7xl overflow-hidden rounded-2xl bg-background p-4 shadow-xl sm:min-h-[calc(100vh-3rem)] sm:p-6 lg:grid-cols-[minmax(26rem,0.9fr)_minmax(32rem,1.1fr)] lg:gap-6">
        <section className="relative flex min-h-full flex-col px-2 py-2 sm:px-8 lg:px-10">
          <div className="flex items-start justify-between gap-4">
            <Link
              href="/"
              className="flex w-fit items-center gap-2 font-semibold tracking-tight text-foreground"
              aria-label="WACRM home"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <MessageSquareText aria-hidden="true" />
              </span>
              WACRM
            </Link>

            <Tabs value={surface} onValueChange={updateSurface} aria-label="Form appearance">
              <TabsList className="h-9 border border-border bg-background/65 p-1 shadow-sm backdrop-blur-xl">
                <TabsTrigger value="glass" className="px-2.5">
                  <Sparkles data-icon="inline-start" aria-hidden="true" />
                  Glass
                </TabsTrigger>
                <TabsTrigger value="solid" className="px-2.5">
                  <PanelsTopLeft data-icon="inline-start" aria-hidden="true" />
                  Solid
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex flex-1 items-center justify-center py-10">
            <div
              className={cn(
                "w-full max-w-md rounded-3xl transition-all duration-300",
                surface === "glass"
                  ? "border border-border/70 bg-background/65 p-6 shadow-2xl backdrop-blur-2xl sm:p-8"
                  : "bg-background p-0",
              )}
            >
              {children}
            </div>
          </div>
        </section>

        <SignupPromoPanel title={promoTitle} description={promoDescription} />
      </div>
    </main>
  );
}
