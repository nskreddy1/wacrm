'use client';

import { cn } from '@/lib/utils';

/**
 * The underlined tab strip used inside settings panels.
 *
 * Extracted verbatim from the markup `FieldsAndTagsPanel` already used,
 * so merged sections (Fields & currency, Integrations) get the exact
 * same affordance rather than a second, slightly-different tab style.
 *
 * Panels that become a tab here render with `embedded` so they drop
 * their own `SettingsPanelHead` — the tab label already names them, and
 * two stacked headings read as a rendering bug.
 */
export function SettingsTabStrip<T extends string>({
  tabs,
  active,
  onSelect,
  label,
  className,
}: {
  tabs: readonly { key: T; label: string }[];
  active: T;
  onSelect: (key: T) => void;
  /** Accessible name for the tablist. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('border-border flex gap-6 border-b', className)}
    >
      {tabs.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          onClick={() => onSelect(item.key)}
          className={cn(
            '-mb-px shrink-0 border-b-2 pb-2.5 text-sm font-medium transition-colors',
            active === item.key
              ? 'border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground border-transparent'
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
