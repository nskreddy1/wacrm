'use client';

/**
 * Shared presentation primitives for the 4-step broadcast wizard.
 *
 * Before this existed each step invented its own boxes: step 1 used
 * `rounded-xl border bg-card/50` cards for templates, step 2 used the
 * same class string but with different padding, step 3 mixed `p-4` and
 * `p-3` panels, and step 4 hand-rolled a summary grid. Same intent,
 * four spellings — so the wizard read as four screens stapled together
 * instead of one flow.
 *
 * Everything here is layout only. One radius scale (`rounded-xl` for
 * panels, `rounded-lg` for controls, `rounded-full` for pills), one
 * panel padding, one header rhythm, one footer. Steps compose these
 * and never re-spell the box.
 */

import type { ComponentType, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* Step heading                                                               */
/* -------------------------------------------------------------------------- */

export function StepHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="space-y-1">
      <h2 className="text-foreground text-base font-semibold tracking-tight">
        {title}
      </h2>
      <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
        {description}
      </p>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel — the one box                                                        */
/* -------------------------------------------------------------------------- */

export type PanelTone = 'default' | 'accent' | 'danger';

const PANEL_ICON_TONE: Record<PanelTone, string> = {
  default: 'text-muted-foreground',
  accent: 'text-primary',
  danger: 'text-destructive',
};

export function WizardPanel({
  icon: Icon,
  title,
  description,
  action,
  tone = 'default',
  className,
  children,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** Right-aligned slot in the header row (counts, badges, buttons). */
  action?: ReactNode;
  tone?: PanelTone;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        'border-border bg-card rounded-xl border p-4 sm:p-5',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {Icon ? (
              <Icon className={cn('size-4 shrink-0', PANEL_ICON_TONE[tone])} />
            ) : null}
            <h3 className="text-foreground text-sm font-medium">{title}</h3>
          </div>
          {description ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Selectable option card                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Radio-card used for audience methods and template picking. Rendered
 * with real radio semantics so arrow keys and screen readers work —
 * the previous plain `<button>` grid announced five unrelated buttons.
 */
export function OptionCard({
  icon: Icon,
  label,
  description,
  selected,
  onSelect,
  meta,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
  /** Small trailing content — a category chip, a language code. */
  meta?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'group focus-visible:ring-ring flex items-start gap-3 rounded-xl border p-4 text-left',
        'transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/40'
      )}
    >
      {Icon ? (
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
            selected
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-start justify-between gap-2">
          <span className="text-foreground text-sm font-medium">{label}</span>
          {meta}
        </span>
        {description ? (
          <span className="text-muted-foreground block text-xs leading-relaxed">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Consistent 1-or-2 column grid for OptionCard sets. */
export function OptionGrid({
  label,
  columns = 2,
  children,
}: {
  /** Accessible group name for the radio set. */
  label: string;
  columns?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'grid grid-cols-1 gap-3',
        columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

/** Shared class for native `<select>`/`<input>` inside wizard panels. */
export const controlClass =
  'border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring h-9 w-full rounded-lg border px-2.5 text-sm outline-none transition-colors duration-150 focus-visible:ring-2';

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground mb-1.5 block text-xs font-medium"
    >
      {children}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Pills                                                                      */
/* -------------------------------------------------------------------------- */

export function TagPill({
  name,
  color,
  selected,
  tone = 'accent',
  onClick,
}: {
  name: string;
  color?: string | null;
  selected: boolean;
  /** `accent` for include lists, `danger` for the exclude list. */
  tone?: 'accent' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-ring inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium',
        'transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none',
        selected
          ? tone === 'danger'
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
      )}
    >
      {color ? (
        <span
          aria-hidden="true"
          className="mr-1.5 size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {name}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline states                                                              */
/* -------------------------------------------------------------------------- */

export function InlineLoading({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-xs">
      <Loader2 className="text-primary size-4 animate-spin" />
      {label}
    </p>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground text-xs leading-relaxed">{children}</p>
  );
}

/**
 * Inline notice. Uses the theme's destructive token plus one amber
 * warning so error and warning never render as two different reds.
 */
export function Notice({
  tone,
  children,
}: {
  tone: 'error' | 'warning';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-amber-500/30 bg-amber-500/10'
      )}
    >
      <AlertTriangle
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'error' ? 'text-destructive' : 'text-amber-500'
        )}
      />
      <p
        className={cn(
          'text-xs leading-relaxed',
          tone === 'error' ? 'text-destructive' : 'text-amber-500'
        )}
      >
        {children}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary rows                                                               */
/* -------------------------------------------------------------------------- */

export function SummaryGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</dl>
  );
}

export function SummaryItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground truncate text-sm font-medium">
        {children}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one footer. Every step gets the same back/next geometry, and the
 * `hint` slot exists so a disabled Next always states its blocking
 * condition instead of reading as a broken button.
 */
export function StepFooter({
  backLabel,
  onBack,
  backDisabled,
  hint,
  children,
  nextLabel,
  onNext,
  nextDisabled,
  showBackArrow = true,
}: {
  backLabel: string;
  onBack: () => void;
  backDisabled?: boolean;
  /** Shown left of the primary action when it is blocked. */
  hint?: ReactNode;
  /** Extra secondary actions rendered before Next (e.g. Save draft). */
  children?: ReactNode;
  nextLabel?: string;
  onNext?: () => void;
  nextDisabled?: boolean;
  showBackArrow?: boolean;
}) {
  return (
    <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-5">
      <Button variant="outline" onClick={onBack} disabled={backDisabled}>
        {showBackArrow ? <ArrowLeft className="size-4" /> : null}
        {backLabel}
      </Button>

      <div className="flex flex-wrap items-center gap-3">
        {hint ? (
          <p className="text-muted-foreground text-xs">{hint}</p>
        ) : null}
        {children}
        {nextLabel && onNext ? (
          <Button onClick={onNext} disabled={nextDisabled}>
            {nextLabel}
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
