// ============================================================
// SettingsRow / SettingsGroup — the settings layout primitive.
//
// One three-column row: label · control · hint. Collapses to a
// single stacked column below `lg`, where a rigid 3-up grid would
// squeeze the control into a few unusable pixels.
//
// Rows carry their own bottom hairline and the group clips it off
// the last child, so a group reads as one continuous surface no
// matter how many rows it holds — callers never manage dividers.
// ============================================================

import type * as React from 'react';

import { cn } from '@/lib/utils';

export function SettingsGroup({
  className,
  ...props
}: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'bg-card rounded-lg border',
        // Hairlines live on the rows; suppress the trailing one so the
        // group's own border is the only edge that shows.
        '[&>*:last-child]:border-b-0',
        className
      )}
      {...props}
    />
  );
}

export function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
  className,
  ...props
}: {
  /** Left column. The row's name — kept short, sentence case. */
  label: React.ReactNode;
  /** Right column. Explains consequence, not mechanics. Optional. */
  hint?: React.ReactNode;
  /**
   * Renders the label as a real `<label>` bound to this control id.
   * Omit for rows whose control is a group (radio set, button pair)
   * rather than one focusable input, where a `for` target would be
   * ambiguous — those should label themselves instead.
   */
  htmlFor?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<'div'>, 'children'>) {
  const Label = htmlFor ? 'label' : 'div';

  return (
    <div
      className={cn(
        'grid grid-cols-1 items-start gap-x-8 gap-y-3 border-b px-5 py-5',
        'lg:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)_minmax(0,18rem)]',
        className
      )}
      {...props}
    >
      <Label
        htmlFor={htmlFor}
        className={cn(
          'text-foreground text-sm leading-6 font-medium',
          htmlFor && 'cursor-pointer'
        )}
      >
        {label}
      </Label>

      <div className="flex min-w-0 flex-col gap-3">{children}</div>

      {hint ? (
        <p className="text-muted-foreground text-sm leading-6">{hint}</p>
      ) : (
        // Hold the third column so controls stay aligned across rows
        // whether or not a given row has a hint.
        <span aria-hidden className="hidden lg:block" />
      )}
    </div>
  );
}
