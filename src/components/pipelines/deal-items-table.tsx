"use client"

import { useId, useMemo, useState } from "react"
import useSWR from "swr"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency, getCurrencySymbol } from "@/lib/currency"

export type DraftDealItem = {
  key: string
  id?: string
  catalogItemId: string | null
  name: string
  listPrice: number
  quantity: number
  discountPct: number
}

type CatalogItem = { id: string; name: string; price: number; category: string | null }

const catalogFetcher = async (url: string): Promise<CatalogItem[]> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error("Unable to load catalog")
  const payload = (await response.json()) as { data?: unknown[] }
  return ((payload.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    price: Number(row.price ?? 0),
    category: row.category ? String(row.category) : null,
  }))
}

export function itemTotal(item: DraftDealItem) {
  return item.listPrice * item.quantity * (1 - item.discountPct / 100)
}

// Bigin's "Associated Products" — our products live in the Catalog module.
export function DealItemsTable({ items, currency, onChange }: {
  items: DraftDealItem[]
  currency: string
  onChange: (items: DraftDealItem[]) => void
}) {
  const [expanded, setExpanded] = useState(items.length > 0)
  const [search, setSearch] = useState("")
  const searchId = useId()
  const { data: catalog, isLoading } = useSWR(expanded ? "/api/v1/workspace/catalog" : null, catalogFetcher)
  const symbol = getCurrencySymbol(currency)

  const matches = useMemo(() => {
    if (!catalog) return []
    const query = search.trim().toLowerCase()
    const used = new Set(items.map((item) => item.catalogItemId))
    const pool = catalog.filter((entry) => !used.has(entry.id))
    if (!query) return pool.slice(0, 6)
    return pool.filter((entry) => entry.name.toLowerCase().includes(query)).slice(0, 6)
  }, [catalog, search, items])

  const grandTotal = items.reduce((sum, item) => sum + itemTotal(item), 0)

  function patch(key: string, partial: Partial<DraftDealItem>) {
    onChange(items.map((item) => (item.key === key ? { ...item, ...partial } : item)))
  }

  function add(entry: CatalogItem) {
    onChange([...items, { key: crypto.randomUUID(), catalogItemId: entry.id, name: entry.name, listPrice: entry.price, quantity: 1, discountPct: 0 }])
    setSearch("")
  }

  if (!expanded && items.length === 0) {
    return (
      <div className="border-t pt-6">
        <button type="button" onClick={() => setExpanded(true)} className="flex w-full items-center gap-2 rounded-lg bg-muted/50 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-muted">
          <Plus className="size-4" aria-hidden="true" />Catalog
        </button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-6" aria-labelledby="deal-items-heading">
      <h2 id="deal-items-heading" className="text-sm font-semibold">Associated Catalog</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">Item</th>
              <th scope="col" className="w-28 px-3 py-2 font-medium">List Price ({symbol})</th>
              <th scope="col" className="w-20 px-3 py-2 font-medium">Quantity</th>
              <th scope="col" className="w-24 px-3 py-2 font-medium">Discount (%)</th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-medium">Total ({symbol})</th>
              <th scope="col" className="w-10 px-1 py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key} className="border-b last:border-b-0">
                <td className="px-3 py-2 font-medium">{item.name}</td>
                <td className="px-3 py-2"><Input type="number" min="0" step="0.01" inputMode="decimal" className="h-8" value={item.listPrice} onChange={(event) => patch(item.key, { listPrice: Number(event.target.value) })} aria-label={`List price for ${item.name}`} /></td>
                <td className="px-3 py-2"><Input type="number" min="1" step="1" inputMode="numeric" className="h-8" value={item.quantity} onChange={(event) => patch(item.key, { quantity: Math.max(1, Number(event.target.value)) })} aria-label={`Quantity for ${item.name}`} /></td>
                <td className="px-3 py-2"><Input type="number" min="0" max="100" step="0.5" inputMode="decimal" className="h-8" value={item.discountPct} onChange={(event) => patch(item.key, { discountPct: Math.min(100, Math.max(0, Number(event.target.value))) })} aria-label={`Discount for ${item.name}`} /></td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(itemTotal(item), currency)}</td>
                <td className="px-1 py-2"><Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => onChange(items.filter((entry) => entry.key !== item.key))} aria-label={`Remove ${item.name}`}><Trash2 /></Button></td>
              </tr>
            ))}
            <tr>
              <td colSpan={6} className="px-3 py-2">
                <div className="relative">
                  <Input id={searchId} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isLoading ? "Loading catalog…" : "Search Catalog"} className="h-8 max-w-64" aria-label="Search catalog items to add" />
                  {matches.length > 0 && search.trim().length > 0 && (
                    <ul className="absolute left-0 top-9 z-10 w-72 overflow-hidden rounded-md border bg-popover shadow-md" role="listbox" aria-label="Catalog matches">
                      {matches.map((entry) => (
                        <li key={entry.id}>
                          <button type="button" role="option" aria-selected="false" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => add(entry)}>
                            <span className="truncate">{entry.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatCurrency(entry.price, currency)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t bg-muted/30">
                <td colSpan={4} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Grand Total</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(grandTotal, currency)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}
