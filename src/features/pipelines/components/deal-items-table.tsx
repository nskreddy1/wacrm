'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Package, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RecordLookup } from '@/components/shared/record-sheet';
import { routes } from '@/lib/routing/routes';
import { formatCurrency, getCurrencySymbol } from '@/lib/currency';

export type DraftDealItem = {
  key: string;
  id?: string;
  catalogItemId: string | null;
  name: string;
  listPrice: number;
  quantity: number;
  discountPct: number;
};

type CatalogItem = {
  id: string;
  name: string;
  price: number;
  category: string | null;
};

const catalogFetcher = async (url: string): Promise<CatalogItem[]> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to load catalog');
  const payload = (await response.json()) as { data?: unknown[] };
  return ((payload.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    price: Number(row.price ?? 0),
    category: row.category ? String(row.category) : null,
  }));
};

export function itemTotal(item: DraftDealItem) {
  return item.listPrice * item.quantity * (1 - item.discountPct / 100);
}

// Bigin's "Associated Products" — our products live in the Catalog module.
export function DealItemsTable({
  items,
  currency,
  onChange,
}: {
  items: DraftDealItem[];
  currency: string;
  onChange: (items: DraftDealItem[]) => void;
}) {
  const [expanded, setExpanded] = useState(items.length > 0);
  const { data: catalog, isLoading } = useSWR(
    expanded ? '/api/v1/workspace/catalog' : null,
    catalogFetcher
  );
  const symbol = getCurrencySymbol(currency);

  // Every unused catalog item is offered up front — the picker is a browsable
  // dropdown, not a type-to-find box. The old version rendered results only
  // while the query was non-empty, so a user who did not already know an item
  // name had no way to discover what the Catalog module contained.
  const options = useMemo(() => {
    const used = new Set(items.map((item) => item.catalogItemId));
    return (catalog ?? [])
      .filter((entry) => !used.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        label: entry.category ? `${entry.name} · ${entry.category}` : entry.name,
        hint: formatCurrency(entry.price, currency),
      }));
  }, [catalog, items, currency]);

  const grandTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);

  function patch(key: string, partial: Partial<DraftDealItem>) {
    onChange(
      items.map((item) => (item.key === key ? { ...item, ...partial } : item))
    );
  }

  function add(catalogItemId: string | null) {
    const entry = (catalog ?? []).find((row) => row.id === catalogItemId);
    if (!entry) return;
    onChange([
      ...items,
      {
        key: crypto.randomUUID(),
        catalogItemId: entry.id,
        name: entry.name,
        listPrice: entry.price,
        quantity: 1,
        discountPct: 0,
      },
    ]);
  }

  if (!expanded && items.length === 0) {
    return (
      <div className="border-t pt-6">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="bg-muted/50 text-primary hover:bg-muted flex w-full items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add products or services
        </button>
      </div>
    );
  }

  return (
    <section
      className="flex flex-col gap-3 border-t pt-6"
      aria-labelledby="deal-items-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="deal-items-heading" className="text-lg font-semibold">
          Products &amp; Services
        </h2>
        <Link
          href={routes.app.catalog}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
        >
          Manage catalog
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-3 py-2 font-medium">
                Product
              </th>
              <th scope="col" className="w-28 px-3 py-2 font-medium">
                List Price ({symbol})
              </th>
              <th scope="col" className="w-20 px-3 py-2 font-medium">
                Quantity
              </th>
              <th scope="col" className="w-24 px-3 py-2 font-medium">
                Discount (%)
              </th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                Total ({symbol})
              </th>
              <th scope="col" className="w-10 px-1 py-2">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key} className="border-b last:border-b-0">
                <td className="px-3 py-2 font-medium">{item.name}</td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="h-8"
                    value={item.listPrice}
                    onChange={(event) =>
                      patch(item.key, { listPrice: Number(event.target.value) })
                    }
                    aria-label={`List price for ${item.name}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    className="h-8"
                    value={item.quantity}
                    onChange={(event) =>
                      patch(item.key, {
                        quantity: Math.max(1, Number(event.target.value)),
                      })
                    }
                    aria-label={`Quantity for ${item.name}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    inputMode="decimal"
                    className="h-8"
                    value={item.discountPct}
                    onChange={(event) =>
                      patch(item.key, {
                        discountPct: Math.min(
                          100,
                          Math.max(0, Number(event.target.value))
                        ),
                      })
                    }
                    aria-label={`Discount for ${item.name}`}
                  />
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatCurrency(itemTotal(item), currency)}
                </td>
                <td className="px-1 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      onChange(items.filter((entry) => entry.key !== item.key))
                    }
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  No products added yet. Pick one from the catalog below.
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="bg-muted/30 border-t">
                <td
                  colSpan={4}
                  className="text-muted-foreground px-3 py-2 text-right text-xs font-medium"
                >
                  Grand Total
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatCurrency(grandTotal, currency)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Browsable dropdown: opens on click with the whole catalog listed and
          narrows as you type, so items are discoverable without knowing a
          name. Selecting appends a line and the picker resets itself. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1 sm:max-w-sm">
          <RecordLookup
            id="deal-catalog-picker"
            value={null}
            options={options}
            placeholder={
              isLoading
                ? 'Loading catalog…'
                : options.length > 0
                  ? 'Select from catalog'
                  : (catalog?.length ?? 0) > 0
                    ? 'Every catalog item is already added'
                    : 'No catalog items yet'
            }
            disabled={isLoading || options.length === 0}
            icon={
              <Package
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
            }
            onSelect={add}
          />
        </div>
        {!isLoading && (catalog?.length ?? 0) === 0 && (
          <p className="text-muted-foreground text-xs">
            Your catalog is empty —{' '}
            <Link
              href={routes.app.catalog}
              className="text-primary underline-offset-4 hover:underline"
            >
              add products or services
            </Link>{' '}
            first.
          </p>
        )}
      </div>
    </section>
  );
}
