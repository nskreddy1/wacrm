"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LoginAmbient } from "@/components/auth/login-ambient";
import { LoginSplit } from "@/components/auth/login-split";

type Variant = "ambient" | "split";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const [variant, setVariant] = useState<Variant>("ambient");

  return (
    <div className="relative">
      <div key={variant} className="login-variant-in">
        {variant === "ambient" ? (
          <LoginAmbient inviteToken={inviteToken} />
        ) : (
          <LoginSplit inviteToken={inviteToken} />
        )}
      </div>

      {/* Temporary design picker — remove once a direction is chosen */}
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/90 p-1 shadow-lg backdrop-blur-sm">
        <VariantButton
          active={variant === "ambient"}
          onClick={() => setVariant("ambient")}
          label="A · Ambient"
        />
        <VariantButton
          active={variant === "split"}
          onClick={() => setVariant("split")}
          label="B · Split"
        />
      </div>
    </div>
  );
}

function VariantButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-out active:scale-[0.97] ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
