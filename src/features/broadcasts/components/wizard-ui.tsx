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

import {
  useEffect,
  useRef,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  X,
} from 'lucide-react';

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
        // Panels appear in response to a choice the user just made, so
        // they announce themselves with one short rise. Gated on
        // motion-safe: a vestibular-sensitive user gets the same panel,
        // instantly.
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200',
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
  index = 0,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
  /** Small trailing content — a category chip, a language code. */
  meta?: ReactNode;
  /** Position in the set, used only to stagger the entrance. */
  index?: number;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      // Entrance stagger is capped so a 30-template grid never makes
      // the last card arrive noticeably late.
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
      className={cn(
        'group focus-visible:ring-ring relative flex items-start gap-3 rounded-xl border p-4 text-left',
        'transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out',
        'focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-backwards motion-safe:duration-300',
        'motion-safe:hover:-translate-y-0.5 active:translate-y-0',
        selected
          ? 'border-primary bg-primary/5 shadow-primary/5 shadow-sm'
          : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/40'
      )}
    >
      {Icon ? (
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
            selected
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground group-hover:text-foreground'
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
      {/* Selection is carried by colour AND a mark, so the state does
          not rely on hue alone (WCAG 1.4.1). */}
      {selected ? (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200 absolute top-2 right-2 flex size-4 items-center justify-center rounded-full"
        >
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Consistent 1-or-2 column grid for OptionCard sets.
 *
 * The cards carry `role="radio"`, which obliges the group to behave
 * like a radio group: exactly one tab stop, arrows to move between
 * options. Previously every card was its own tab stop and arrows did
 * nothing, so a keyboard user tabbed through five "radios" that the
 * screen reader announced as a group they could not navigate.
 *
 * Tab order is managed on the DOM rather than through cloned props so
 * any caller's children shape keeps working.
 */
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
  const ref = useRef<HTMLDivElement>(null);

  function radios(): HTMLElement[] {
    return Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []
    );
  }

  // Roving tabindex: the checked option owns the tab stop, falling back
  // to the first option while nothing is checked (template step).
  useEffect(() => {
    const items = radios();
    if (items.length === 0) return;
    const checked = items.findIndex(
      (el) => el.getAttribute('aria-checked') === 'true'
    );
    const stop = checked === -1 ? 0 : checked;
    items.forEach((el, i) => {
      el.tabIndex = i === stop ? 0 : -1;
    });
  });

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const items = radios();
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    event.preventDefault();

    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;

    // Radio-group convention: moving focus also selects.
    items[next].focus();
    items[next].click();
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
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

/**
 * Removable chip for an explicitly picked entity (a contact). The
 * label and the remove control are one button on purpose: the whole
 * chip means "this person is in — click to take them out", and a
 * second nested button would double the tab stops in a list that can
 * hold dozens of chips.
 */
export function RemovableChip({
  label,
  detail,
  removeLabel,
  onRemove,
}: {
  label: string;
  /** Secondary text (a phone number) shown after the label. */
  detail?: string;
  /** Accessible name for the action, e.g. "Remove Ada Lovelace". */
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={removeLabel}
      className={cn(
        'border-primary/40 bg-primary/10 text-primary focus-visible:ring-ring group inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        'transition-colors duration-150 hover:bg-primary/20 focus-visible:ring-2 focus-visible:outline-none',
        'motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in-0 motion-safe:duration-150'
      )}
    >
      <span className="truncate">{label}</span>
      {detail ? (
        <span className="text-primary/70 truncate font-normal tabular-nums">
          {detail}
        </span>
      ) : null}
      <X className="size-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/**
 * Multi-select row. Real checkbox semantics (`role="checkbox"` +
 * `aria-checked`) so a screen reader announces "checked/unchecked"
 * instead of an unlabelled button, and the whole row is the hit target.
 */
export function CheckRow({
  title,
  subtitle,
  checked,
  onToggle,
  disabled,
  badge,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Trailing note — an opt-out warning, a tag count. */
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left',
        'transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-primary/40 bg-primary/5'
          : 'border-transparent hover:bg-muted/60'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-150',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40'
        )}
      >
        {checked ? (
          <Check
            className="motion-safe:animate-in motion-safe:zoom-in-50 size-3 motion-safe:duration-150"
            strokeWidth={3}
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {title}
        </span>
        {subtitle ? (
          <span className="text-muted-foreground block truncate text-xs tabular-nums">
            {subtitle}
          </span>
        ) : null}
      </span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
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
