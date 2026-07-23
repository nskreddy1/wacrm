import type { AccountMember } from '@/types';

/**
 * Fetch the current account's members from the API (which applies the
 * email-visibility rules — agents/viewers don't see emails). Best-effort:
 * returns `[]` on any error or on an older deployment without the
 * endpoint, so callers can fall back to a queue-only / raw-id picker.
 *
 * Client-side only (uses `fetch` against the relative API route).
 */
export async function fetchAccountMembers(): Promise<AccountMember[]> {
  try {
    const res = await fetch('/api/account/members', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { members?: AccountMember[] };
    return json.members ?? [];
  } catch {
    return [];
  }
}

/**
 * Display label for a member: full name → prettified email ("Admin
 * (admin@gmail.com)") → short id ("Member 1a2b3c4d"). Raw UUIDs and
 * bare emails never surface in pickers.
 */
export function memberLabel(m: AccountMember): string {
  if (m.full_name) return m.full_name;
  if (m.email) {
    const local = m.email.split('@')[0] ?? '';
    const pretty = local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return pretty ? `${pretty} (${m.email})` : m.email;
  }
  return `Member ${m.user_id.slice(0, 8)}`;
}
