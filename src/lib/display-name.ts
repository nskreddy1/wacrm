/**
 * Display-identity helpers.
 *
 * At signup, `handle_new_user` falls back to the user's EMAIL for both
 * the workspace (accounts.name) and — when no full name was provided —
 * the profile display name. That produced the "same email in two
 * places" sidebar bug. These helpers derive human-friendly labels from
 * email-shaped values so raw addresses never render as names.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL_RE.test(value.trim());
}

/**
 * "admin@gmail.com" -> "Admin", "jane.doe@x.io" -> "Jane Doe".
 * Non-email input is returned trimmed and unchanged.
 */
export function friendlyNameFromEmail(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!looksLikeEmail(trimmed)) return trimmed;
  const local = trimmed.split("@")[0] ?? "";
  return local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Preferred person label: full name when present, otherwise a
 * friendly name derived from the email — never the raw address.
 */
export function personDisplayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = fullName?.trim();
  if (name) return name;
  const friendly = friendlyNameFromEmail(email);
  return friendly || "Account";
}

/**
 * Workspace label: the stored account name, unless it's still the
 * signup-default email — then "<Friendly>'s workspace".
 */
export function workspaceDisplayName(accountName: string | null | undefined): string {
  const name = accountName?.trim();
  if (!name) return "Workspace";
  if (!looksLikeEmail(name)) return name;
  const friendly = friendlyNameFromEmail(name);
  return friendly ? `${friendly}'s workspace` : "Workspace";
}
