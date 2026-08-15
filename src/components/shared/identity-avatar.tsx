/**
 * Identity avatars — one source of truth for how a *workspace* and a
 * *person* are drawn.
 *
 * Why this file exists: the same two identities were being drawn eight
 * different ways. The sidebar, the workspace switcher, the welcome
 * overlay, the members table and the profile form each rolled their own
 * initials + fallback styling, so the same account appeared as "R" in
 * one place and "RA" in another, and a workspace was visually
 * indistinguishable from a user.
 *
 * Two deliberate rules:
 *
 *  1. Shape carries the meaning. A workspace is a squared-off rounded
 *     square (like an app icon / org mark); a person is a circle. That
 *     distinction is legible at 24px without reading any text, and it is
 *     the same convention Slack, Linear and Notion use.
 *  2. Colour is derived from the name, not random and not per-render, so
 *     a given workspace keeps the same tint everywhere it appears.
 *
 * Both fall back to initials, and both accept an image once uploads
 * exist, so no caller needs to branch on "do we have a logo yet".
 */

'use client';

import Image from 'next/image';

import { cn } from '@/lib/utils';

/** Sizes map to the real usages: rail 24-32, headers 40, hero 64+. */
type IdentitySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<IdentitySize, string> = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-20 text-2xl',
};

/** Pixel sizes for next/image, kept in lockstep with SIZE_CLASS. */
const SIZE_PX: Record<IdentitySize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

/**
 * Five tints drawn from the theme's chart tokens rather than raw hex, so
 * the avatars re-theme with the rest of the app and stay inside the
 * project's colour budget. Each entry is a gradient pair: the subtle
 * depth is what reads as "premium" instead of a flat grey chip.
 */
const TINTS = [
  'from-chart-1/25 to-chart-1/5 text-chart-1 ring-chart-1/20',
  'from-chart-2/25 to-chart-2/5 text-chart-2 ring-chart-2/20',
  'from-chart-3/25 to-chart-3/5 text-chart-3 ring-chart-3/20',
  'from-chart-4/25 to-chart-4/5 text-chart-4 ring-chart-4/20',
  'from-chart-5/25 to-chart-5/5 text-chart-5 ring-chart-5/20',
] as const;

/**
 * Stable name → tint. A plain character sum is enough here (this is
 * cosmetic, not security) and, being deterministic, it guarantees the
 * same workspace is the same colour on every screen and every reload.
 */
function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % 9973;
  }
  return TINTS[hash % TINTS.length];
}

/**
 * Two initials, from the first two words when there are two ("Acme Corp"
 * -> "AC"), otherwise the first two letters ("wacrm" -> "WA").
 *
 * This was the visible inconsistency: the welcome screen took one letter
 * while the switcher took two, so the same account rendered differently
 * in two places. Emails are trimmed at the "@" first, otherwise every
 * gmail user would read as "GM".
 */
export function identityInitials(
  name: string | null | undefined,
  fallback = '?'
): string {
  const cleaned = (name ?? '').split('@')[0].replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const parts = cleaned.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

interface IdentityAvatarProps {
  /** Display name; also seeds the colour and the initials. */
  name: string | null | undefined;
  /** Logo / photo once one exists. Falls back to initials when absent. */
  imageUrl?: string | null;
  size?: IdentitySize;
  className?: string;
  /**
   * Workspaces get a rounded square, people get a circle. This is the
   * only prop that changes the silhouette.
   */
  kind: 'workspace' | 'user';
}

export function IdentityAvatar({
  name,
  imageUrl,
  size = 'sm',
  className,
  kind,
}: IdentityAvatarProps) {
  const label = name?.trim() || (kind === 'workspace' ? 'Workspace' : 'User');
  const initials = identityInitials(label, kind === 'workspace' ? 'W' : 'U');
  const isWorkspace = kind === 'workspace';

  return (
    <span
      // aria-hidden + a real text label on the parent is the usual
      // pattern, but these often appear alone (rail, table cell), so the
      // avatar carries its own accessible name instead.
      role="img"
      aria-label={`${label} ${isWorkspace ? 'workspace' : 'user'} avatar`}
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden',
        'bg-gradient-to-br font-semibold ring-1 select-none',
        // Shape is the signal: app-icon square vs person circle.
        isWorkspace ? 'rounded-[28%]' : 'rounded-full',
        SIZE_CLASS[size],
        tintFor(label.toLowerCase()),
        className
      )}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          width={SIZE_PX[size]}
          height={SIZE_PX[size]}
          className="size-full object-cover"
        />
      ) : (
        <span className="leading-none tracking-tight">{initials}</span>
      )}
    </span>
  );
}
