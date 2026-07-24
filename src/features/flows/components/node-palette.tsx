'use client';

/**
 * NodePalette — the shared "add a step" surface for the flow editor.
 *
 * One component, two consumers (canvas floating button + list-view
 * toolbar button), so the palette look/behavior can never drift
 * between views. Modeled after the block pickers in modern enterprise
 * builders (HubSpot workflows, Intercom Series, Linear command menu):
 *
 *   - Searchable: type-to-filter across labels AND descriptions.
 *   - Grouped: categories keep the 16 node types scannable.
 *   - Keyboard-first: ArrowUp/Down + Enter to insert, Esc to close.
 *   - Fully derived from NODE_META — a newly registered node type
 *     shows up here automatically; nothing is hardcoded.
 *
 * Performance: the filtered/grouped model is memoized per query and
 * rows are plain DOM (no per-row state), so filtering 16 items is a
 * single cheap pass on each keystroke.
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  NODE_CATEGORIES,
  NODE_META,
  NodeIconChip,
  type NodeType,
} from './shared';

/** Every registered node type, in NODE_META's flow-reading order. */
const ALL_TYPES = Object.keys(NODE_META) as NodeType[];

interface PaletteRow {
  type: NodeType;
  label: string;
  blurb: string;
}

interface PaletteGroup {
  id: string;
  label: string;
  rows: PaletteRow[];
}

export function NodePalette({
  onAdd,
  variant = 'subtle',
  align = 'end',
}: {
  onAdd: (type: NodeType) => void;
  /** `primary` = filled CTA (canvas), `subtle` = outlined (toolbar). */
  variant?: 'primary' | 'subtle';
  align?: 'start' | 'center' | 'end';
}) {
  const t = useTranslations('Flows.builder');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIx, setActiveIx] = useState(0);
  // Defer filtering so fast typists never block the input paint.
  const deferredQuery = useDeferredValue(query);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Resolve translations once per open/query — rows carry their
  // strings so both filtering and rendering read from one place.
  const groups = useMemo<PaletteGroup[]>(() => {
    const q = deferredQuery.trim().toLowerCase();
    return NODE_CATEGORIES.map((cat) => {
      const rows = ALL_TYPES.filter(
        (type) => NODE_META[type].category === cat.id
      )
        .map((type) => ({
          type,
          label: t(`nodes.${type}.label`),
          blurb: t(`nodes.${type}.blurb`),
        }))
        .filter(
          (r) =>
            q.length === 0 ||
            r.label.toLowerCase().includes(q) ||
            r.blurb.toLowerCase().includes(q)
        );
      return { id: cat.id, label: t(`categories.${cat.id}`), rows };
    }).filter((g) => g.rows.length > 0);
  }, [deferredQuery, t]);

  /** Flat row list — the keyboard cursor walks this. */
  const flatRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  // Clamp at read time instead of a setState-in-effect: when the
  // filter shrinks the list the cursor stays valid on the same render
  // pass, with no cascading re-render.
  const cursor = Math.min(activeIx, Math.max(0, flatRows.length - 1));

  const reset = useCallback(() => {
    setQuery('');
    setActiveIx(0);
  }, []);

  const pick = useCallback(
    (type: NodeType) => {
      setOpen(false);
      reset();
      onAdd(type);
    },
    [onAdd, reset]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIx(Math.min(cursor + 1, flatRows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIx(Math.max(cursor - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = flatRows[cursor];
      if (row) pick(row.type);
    }
  };

  // Keep the active row visible as the cursor moves.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger
        aria-label={t('addNode')}
        className={cn(
          'inline-flex items-center gap-1.5 font-medium transition-colors',
          variant === 'primary'
            ? 'bg-primary text-primary-foreground hover:bg-primary-hover rounded-lg px-3.5 py-2 text-[13px] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)]'
            : 'border-border bg-card text-foreground hover:bg-muted rounded-md border px-3 py-1.5 text-xs'
        )}
      >
        <Plus className={variant === 'primary' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        {t('addNode')}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        className="border-border bg-popover w-[340px] overflow-hidden rounded-xl p-0 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.45)]"
        onKeyDown={onKeyDown}
      >
        {/* ---- search header ---- */}
        <div className="border-border flex items-center gap-2 border-b px-3.5 py-2.5">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <input
            // The palette is a command-menu; focus belongs in search.
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIx(0);
            }}
            placeholder={t('searchNodes')}
            aria-label={t('searchNodes')}
            className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-[13px] outline-none"
          />
          <kbd className="border-border text-muted-foreground hidden rounded border px-1.5 py-0.5 text-[10px] font-medium sm:block">
            esc
          </kbd>
        </div>

        {/* ---- grouped results ---- */}
        <div
          ref={listRef}
          role="listbox"
          aria-label={t('addNode')}
          className="max-h-[400px] overflow-y-auto p-1.5"
        >
          {flatRows.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-[12.5px]">
              {t('noNodesMatch')}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.id} className="mb-1 last:mb-0">
                <p className="text-muted-foreground px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                  {group.label}
                </p>
                {group.rows.map((row) => {
                  const ix = flatRows.indexOf(row);
                  const active = ix === cursor;
                  return (
                    <button
                      key={row.type}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onMouseEnter={() => setActiveIx(ix)}
                      onClick={() => pick(row.type)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                        active ? 'bg-muted' : 'hover:bg-muted/60'
                      )}
                    >
                      <NodeIconChip type={row.type} size={32} iconSize={17} />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-popover-foreground truncate text-[13px] font-semibold">
                          {row.label}
                        </span>
                        <span className="text-muted-foreground truncate text-[11.5px]">
                          {row.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
