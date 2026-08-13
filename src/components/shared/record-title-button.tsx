import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Canonical "click the record title to open it" affordance (ADR-003 D1).
 *
 * Every record-list surface (Contacts, Pipelines, Catalog, Appointments)
 * renders its record title through this button so hover and keyboard focus
 * behaviour stay identical everywhere. Wrap it in the surface's own heading
 * element (h2/h3) to keep heading semantics intact.
 *
 * Do NOT use this inside a dnd-kit draggable that spreads {...listeners} over
 * the same region, and do not nest it inside a whole-card button — whole-card
 * click targets are only permitted when the card contains no other
 * interactive controls (ADR-003 D1, Broadcasts variant).
 */
export function RecordTitleButton({
  onOpen,
  children,
  className,
}: {
  onOpen: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'hover:text-primary focus-visible:ring-ring max-w-full truncate rounded text-left font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none',
        className
      )}
    >
      {children}
    </button>
  );
}
