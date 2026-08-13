'use client';

import type { ReactNode } from 'react';

import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BulkActionBarProps {
  /** Number of selected rows. The bar renders nothing when this is 0, so
      callers do not need their own conditional wrapper. */
  count: number;
  /** Optional clarification of what the actions apply to. Hidden on small
      screens, where horizontal room is needed for the buttons themselves. */
  hint?: string;
  onClear: () => void;
  /** Bulk action buttons, pushed to the trailing edge. Each surface supplies
      its own — Delete, Archive, Assign — because the safe set differs by
      module and by role. */
  children?: ReactNode;
  className?: string;
}

/**
 * The canonical bulk-action bar for multi-select surfaces (ADR-003 D2).
 *
 * Shared rather than per-feature so the selection count, the Clear affordance
 * and the announcement behaviour stay identical everywhere. Before this
 * existed, Contacts carried the only copy of this markup and Catalog had no
 * bulk UI at all despite its API supporting bulk delete.
 *
 * The count is a polite live region: selecting rows is a state change with no
 * visible focus move, so screen-reader users would otherwise get no feedback.
 */
export function BulkActionBar({
  count,
  hint,
  onClear,
  children,
  className,
}: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        'bg-muted flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm',
        className
      )}
    >
      <strong aria-live="polite">{count} selected</strong>
      {hint ? (
        <span className="text-muted-foreground hidden sm:inline">{hint}</span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X data-icon="inline-start" /> Clear selection
      </Button>
    </div>
  );
}
