'use client';

import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * The single filter/action bar that sits directly above a module's content.
 *
 * Extracted from the Contacts toolbar, which is the reference implementation
 * every module should match. Two layout rules make it read as deliberate
 * rather than a pile of controls:
 *
 *   1. The search field is the only flexible child, so it absorbs leftover
 *      width instead of leaving dead space.
 *   2. Trailing controls are pushed to the far edge with `ml-auto`, so the
 *      bar is anchored at both ends. Without this, a module with few
 *      controls (Appointments, Catalog) packs everything against the left
 *      and strands a large gap on the right.
 *
 * This deliberately does NOT own a page title. These modules are already
 * named by the surrounding app chrome, so a rendered heading would only
 * cost vertical space above the content that matters.
 */
export function WorkspaceToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-card flex flex-wrap items-center gap-2 border-b px-3 py-2',
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Right-anchored zone for view switchers and the primary action.
 *
 * `ml-auto` only applies once the bar has room for a single row; when the
 * toolbar wraps on narrow screens the group falls in line normally instead
 * of being flung to the opposite edge of its own row.
 */
export function WorkspaceToolbarActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 sm:ml-auto', className)}>
      {children}
    </div>
  );
}

/**
 * Hairline divider between groups of controls. Grouping is what keeps a
 * dense bar from reading as one undifferentiated run of buttons.
 *
 * Hidden while the toolbar is wrapped, where a vertical rule between
 * stacked rows would be meaningless.
 */
export function WorkspaceToolbarSeparator({
  className,
}: {
  className?: string;
}) {
  return (
    <Separator
      orientation="vertical"
      className={cn('hidden h-5 sm:block', className)}
    />
  );
}

/**
 * Search field with a clear affordance, matching Contacts exactly.
 *
 * `min-w-56 flex-1` with a `sm:max-w-sm` cap lets it grow into free space
 * without crowding out the controls beside it. The clear button only exists
 * while there is a query — an always-present one would be a permanent
 * dead target.
 */
export function WorkspaceToolbarSearch({
  value,
  onValueChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  /** Accessible name, e.g. "Search appointments". Also names the clear button. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-56 flex-1 sm:max-w-sm', className)}>
      <Search
        className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pr-8 pl-8"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          onClick={() => onValueChange('')}
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
