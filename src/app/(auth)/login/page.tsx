"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LoginSplit } from "@/components/auth/login-split";

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

  return <LoginSplit inviteToken={inviteToken} />;
}
