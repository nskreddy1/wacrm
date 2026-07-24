'use client';

// ============================================================
// Catalog workspace — products/services management surface
// backed by /api/v1/workspace/catalog. Items created here are
// bookable from the appointments scheduler.
// ============================================================

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Archive,
  ArchiveRestore,
  CircleDollarSign,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { formatCurrencyPrecise } from '@/lib/currency';
import type { CatalogItem } from '@/lib/data/operations/types';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CatalogRecordSheet } from '@/features/catalog/components/catalog-record-sheet';
import { cn } from '@/lib/utils';

type CatalogResponse = { data: CatalogItem[] };

const CATALOG_ENDPOINT = '/api/v1/workspace/catalog?includeInactive=true';

/** Full catalog workspace: KPI strip, filterable item list, create/edit/archive/delete. */
export function CatalogWorkspace() {
  const { data, isLoading, mutate } = useSWR<CatalogResponse>(CATALOG_ENDPOINT);
  // One workspace currency (Settings → Deals) renders every price;
  // per-item currency drift is never shown to the user.
  const { defaultCurrency } = useAuth();

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);

  const items = useMemo(() => data?.data ?? [], [data]);

  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const item of items) {
      if (item.category) unique.add(item.category);
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const stats = useMemo(() => {
    const active = items.filter((item) => item.isActive);
    const averagePrice =
      active.length > 0
        ? active.reduce((sum, item) => sum + item.price, 0) / active.length
        : 0;
    return {
      total: items.length,
      active: active.length,
      categories: categories.length,
      averagePrice,
    };
  }, [items, categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack =
        `${item.name} ${item.description ?? ''} ${item.category ?? ''}`.toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter)
        return false;
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'archived' && item.isActive) return false;
      return true;
    });
  }, [items, query, categoryFilter, statusFilter]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(item: CatalogItem) {
    setEditing(item);
    setDialogOpen(true);
  }

  async function toggleActive(item: CatalogItem) {
    const res = await fetch('/api/v1/workspace/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
    });
    if (!res.ok) {
      toast.error('Could not update the catalog item');
      return;
    }
    toast.success(item.isActive ? 'Item archived' : 'Item restored');
    void mutate();
  }

  async function deleteItem(item: CatalogItem) {
    const res = await fetch('/api/v1/workspace/catalog', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [item.id] }),
    });
    if (!res.ok) {
      toast.error('Could not delete the catalog item');
      return;
    }
    toast.success(`"${item.name}" deleted`);
    void mutate();
  }

  const kpis = [
    {
      label: 'Total items',
      value: String(stats.total),
      Icon: Package,
      note: 'Everything in your catalog',
    },
    {
      label: 'Active',
      value: String(stats.active),
      Icon: CircleDollarSign,
      note: 'Bookable right now',
    },
    {
      label: 'Categories',
      value: String(stats.categories),
      Icon: Tags,
      note: 'Distinct groupings',
    },
    {
      label: 'Average price',
      value:
        stats.active > 0
          ? formatCurrencyPrecise(stats.averagePrice, defaultCurrency)
          : '—',
      Icon: CircleDollarSign,
      note: 'Across active items',
    },
  ];

  return (
    <main className="flex min-h-full flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <p className="text-primary text-sm font-medium">Operations</p>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            Catalog
          </h1>
          <p className="text-muted-foreground text-sm text-pretty">
            Manage the products and services your team schedules and sells.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" /> New item
        </Button>
      </header>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Catalog overview"
      >
        {kpis.map(({ label, value, Icon, note }) => (
          <Card key={label}>
            <CardContent className="flex items-start justify-between gap-3 p-5">
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-sm">{label}</p>
                <p className="text-foreground text-3xl font-semibold tracking-tight tabular-nums">
                  {value}
                </p>
                <p className="text-muted-foreground text-xs">{note}</p>
              </div>
              <div className="bg-primary/10 text-primary rounded-lg p-2">
                <Icon className="size-5" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="border-border border-b">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div>
              <CardTitle>Items</CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                Services and products available for scheduling
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search
                  className="text-muted-foreground absolute top-2.5 left-3 size-4"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search catalog"
                  className="pl-9 sm:w-64"
                  placeholder="Search name, category"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Select
                items={{
                  all: 'All categories',
                  ...Object.fromEntries(categories.map((c) => [c, c])),
                }}
                value={categoryFilter}
                onValueChange={(value) => setCategoryFilter(value ?? 'all')}
              >
                <SelectTrigger
                  className="sm:w-44"
                  aria-label="Filter by category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={{
                  all: 'All statuses',
                  active: 'Active',
                  archived: 'Archived',
                }}
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value ?? 'all')}
              >
                <SelectTrigger
                  className="sm:w-36"
                  aria-label="Filter by status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-16 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />{' '}
              Loading catalog
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-16 text-center">
              <div className="bg-muted text-muted-foreground rounded-xl p-3">
                <Package className="size-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-foreground font-medium">
                  No catalog items found
                </p>
                <p className="text-muted-foreground text-sm">
                  Create your first item or adjust the filters.
                </p>
              </div>
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" /> Add item
              </Button>
            </div>
          ) : (
            <div className="divide-border divide-y">
              {filtered.map((item) => (
                <article
                  key={item.id}
                  className="hover:bg-muted/40 flex flex-col gap-4 p-4 transition-colors md:flex-row md:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-lg',
                        item.isActive
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <Package className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-foreground truncate font-medium">
                        {item.name}
                      </p>
                      <p className="text-muted-foreground truncate text-sm">
                        {item.category ?? 'Uncategorized'}
                        {item.description ? ` · ${item.description}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-foreground w-24 text-right text-sm font-semibold tabular-nums">
                      {formatCurrencyPrecise(item.price, defaultCurrency)}
                    </span>
                    <span
                      className={cn(
                        'w-fit rounded-full border px-2.5 py-1 text-xs font-medium',
                        item.isActive
                          ? 'border-positive/30 bg-positive/10 text-positive'
                          : 'border-border bg-muted text-muted-foreground'
                      )}
                    >
                      {item.isActive ? 'Active' : 'Archived'}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Actions for ${item.name}`}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => openEdit(item)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => void toggleActive(item)}
                        >
                          {item.isActive ? <Archive /> : <ArchiveRestore />}
                          {item.isActive ? 'Archive' : 'Restore'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => void deleteItem(item)}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CatalogRecordSheet
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
        onSaved={() => void mutate()}
      />
    </main>
  );
}
