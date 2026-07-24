'use client';

import { useAuth } from '@/features/auth/hooks/use-auth';
import type { PermissionSlug } from '@/features/auth/lib/permissions';

/**
 * Typed action keys for `useCan`. These map onto capability flags
 * derived from the member's workspace-profile permissions (see
 * `deriveCapabilities` in `@/features/auth/lib/permissions`). Keeping the
 * list closed lets the compiler catch typos at every call site.
 */
export type CanAction =
  | 'manage-members'
  | 'edit-settings'
  | 'send-messages'
  | 'view-only'
  | 'delete-account'
  | 'transfer-ownership';

/**
 * Inline alternative to `<RequireRole>` for places that need a
 * boolean rather than a render conditional — typically disabled-
 * state on buttons, the readOnly flag on inputs, or controlling
 * tooltip copy ("Read-only" vs the action label).
 *
 * Returns `false` while `profileLoading` is true so transient
 * "you can!" flashes never appear to under-privileged users.
 *
 * Example:
 *   const canEdit = useCan("edit-settings");
 *   <Button disabled={!canEdit} title={canEdit ? "Save" : "Read-only"} />
 */
export function useCan(action: CanAction): boolean {
  const {
    profileLoading,
    profile,
    isOwner,
    canManageMembers,
    canEditSettings,
    canSendMessages,
  } = useAuth();
  if (profileLoading || !profile) return false;

  switch (action) {
    case 'manage-members':
      return canManageMembers;
    case 'edit-settings':
      return canEditSettings;
    case 'send-messages':
      return canSendMessages;
    case 'view-only':
      return !canSendMessages && !canEditSettings;
    case 'delete-account':
    case 'transfer-ownership':
      // Destructive account-level actions stay owner-only ("Super
      // Admin" semantics) — no permission slug can grant these.
      return isOwner;
    default: {
      // Exhaustiveness check — adding a new `CanAction` without a
      // case here fails the typecheck because TS narrows `action`
      // to `never` in this branch.
      const _exhaustive: never = action;
      throw new Error(`Unknown CanAction: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Permission-slug variant of `useCan` — preferred for new call
 * sites. `usePermission("broadcasts:send")` is `true` iff the
 * member's workspace profile holds the slug (owners always pass).
 */
export function usePermission(slug: PermissionSlug): boolean {
  const { profileLoading, profile, can } = useAuth();
  if (profileLoading || !profile) return false;
  return can(slug);
}
