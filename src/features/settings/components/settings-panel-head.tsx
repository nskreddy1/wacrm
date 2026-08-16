import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Section header shown at the top of every settings panel — a title,
 * a one-line description, and an optional right-aligned action (e.g.
 * "New template", "Invite member"). Mirrors the mockup's `.panel-head`.
 */
export function SettingsPanelHead({
  title,
  srOnlyTitle = false,
  description,
  action,
  className,
}: {
  title: string;
  /**
   * Render the title for assistive tech only. Used when the panel is a
   * tab inside a merged section: the tab label is already the visible
   * name, so a second visible heading reads as a duplicate — but the
   * document still needs the heading in its outline.
   */
  srOnlyTitle?: boolean;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <h2
          className={cn(
            srOnlyTitle
              ? 'sr-only'
              : 'text-foreground text-lg font-semibold tracking-tight'
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
