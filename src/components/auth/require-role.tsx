"use client";

import type { ReactNode } from "react";

import { useAuth } from "@/hooks/use-auth";
import type { AccountRole } from "@/lib/auth/roles";
import type { PermissionSlug } from "@/lib/auth/permissions";

interface RequireRoleProps {
  /** Legacy minimum-tier gate. Maps onto permission-derived
   *  capabilities: viewer → everyone, agent → can send messages,
   *  admin → can edit settings, owner → workspace owner. Prefer
   *  `permission` for new call sites. */
  min?: AccountRole;
  /** Permission-slug gate — `permission="broadcasts:send"` renders
   *  children iff the member's workspace profile holds the slug
   *  (owners always pass). Takes precedence over `min` when both
   *  are provided. */
  permission?: PermissionSlug;
  /** What to render while access is below the gate OR while the
   *  session is still loading. Defaults to `null` — most call sites
   *  just want the gated element to be absent until we're sure. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * `<RequireRole permission="settings:manage">…</RequireRole>` —
 * conditional render helper for UI gated by workspace-profile
 * permissions.
 *
 * Three states:
 *   1. profileLoading → render `fallback` (fail closed so we never
 *      flash gated content to an under-privileged user).
 *   2. access ≥ gate  → render `children`.
 *   3. access < gate  → render `fallback`.
 *
 * Mirrors the server-side `requirePermission(slug)` / `requireRole(min)`
 * from `@/lib/auth/account` so client and server gates stay aligned.
 */
export function RequireRole({
  min,
  permission,
  fallback = null,
  children,
}: RequireRoleProps) {
  const {
    profileLoading,
    profile,
    isOwner,
    canEditSettings,
    canSendMessages,
    can,
  } = useAuth();

  if (profileLoading || !profile) return <>{fallback}</>;

  if (permission) {
    return can(permission) ? <>{children}</> : <>{fallback}</>;
  }

  const ok =
    !min || min === "viewer"
      ? true
      : min === "agent"
        ? canSendMessages
        : min === "admin"
          ? canEditSettings
          : isOwner;

  return ok ? <>{children}</> : <>{fallback}</>;
}
