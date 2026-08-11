'use client';

// ============================================================
// Catalog workspace — products/services management surface
// backed by /api/v1/workspace/catalog. Items created here are
// bookable from the appointments scheduler.
//
// Chrome matches Contacts and Appointments: one WorkspaceToolbar
// above a flat, dense list. The previous page header + four KPI
// cards spent roughly half the viewport before the first row;
// the numbers that were worth keeping now live in a single
// summary line under the bar.
// ============================================================

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Archive,
  ArchiveRestore,
  Filter,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { formatCurrencyPrecise } from '@/lib/currency';
import type { CatalogItem } from '@/lib/data/operations/types';
import { useAuth } from '@/features/auth/hooks/use-auth';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ListRowsSkeleton } from '@/components/ui/loading-skeletons';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarSearch,
  WorkspaceToolbarSeparator,
} from '@/components/shared/workspace-toolbar';
import { CatalogRecordSheet } from '@/features/catalog/components/catalog-record-sheet';
import { cn } from '@/lib/utils';

type CatalogResponse = { data: CatalogItem[] };

const CATALOG_ENDPOINT = '/api/v1/workspace/catalog?includeInactive=true';

/** Full catalog workspace: filterable item list with create/edit/archive/delete. */
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
  const [pendingDelete, setPendingDelete] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const hasFilters =
    Boolean(query) || categoryFilter !== 'all' || statusFilter !== 'all';

  /* Badge count excludes the search box, which carries its own clear
     affordance — the same split Contacts and Appointments use. */
  const activeFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);

  function clearFilters() {
    setQuery('');
    setCategoryFilter('all');
    setStatusFilter('all');
  }

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

  /* Deletes are confirmed, not immediate: an item may already be booked
     on appointments, and there is no undo behind this endpoint. */
  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/v1/workspace/catalog', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [pendingDelete.id] }),
      });
      if (!res.ok) throw new Error();
      toast.success(`"${pendingDelete.name}" deleted`);
      setPendingDelete(null);
      await mutate();
    } catch {
      toast.error('Could not delete the catalog item');
    } finally {
      setDeleting(false);
    }
  }

  return (
    /* h-full + overflow-hidden: the dashboard shell's content region is
       height-bounded and clips, so scrolling belongs to the list below,
       keeping the toolbar pinned. The shell also owns the page's <main>
       landmark, so this stays a plain <div>. */
    <div className="bg-background flex h-full min-h-0 flex-col overflow-hidden">
      {/* Visually hidden: the app chrome already names the route, so a
          rendered title only cost vertical space. Kept for the document
          outline (WCAG 1.3.1), matching Contacts and Appointments. */}
      <h1 className="sr-only">Catalog</h1>

      <WorkspaceToolbar>
        <Select
          items={{
            all: 'All categories',
            ...Object.fromEntries(categories.map((c) => [c, c])),
          }}
          value={categoryFilter}
          onValueChange={(value) => setCategoryFilter(value ?? 'all')}
        >
          <SelectTrigger className="w-40" aria-label="Filter by category">
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

        <WorkspaceToolbarSearch
          value={query}
          onValueChange={setQuery}
          placeholder="Search name, category"
          label="Search catalog"
        />

        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant={activeFilterCount ? 'secondary' : 'outline'}
                size="sm"
              >
                <Filter data-icon="inline-start" /> Filter
                {activeFilterCount > 0 && (
                  <Badge variant="secondary">{activeFilterCount}</Badge>
                )}
              </Button>
            }
          />
          <PopoverContent align="end" className="w-64">
            <div className="flex flex-col gap-3">
              <Select
                items={{
                  all: 'All statuses',
                  active: 'Active',
                  archived: 'Archived',
                }}
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value ?? 'all')}
              >
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X data-icon="inline-start" /> Clear filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* aria-live so filtering announces the new total. */}
        <span
          className="text-muted-foreground text-xs tabular-nums"
          aria-live="polite"
        >
          {filtered.length}
        </span>

        <WorkspaceToolbarActions>
          <WorkspaceToolbarSeparator />
          <Button size="sm" className="shadow-xs" onClick={openCreate}>
            <Plus data-icon="inline-start" /> New item
          </Button>
        </WorkspaceToolbarActions>
      </WorkspaceToolbar>

      {/* One line of summary instead of a card grid: same four numbers,
          a fraction of the height, and it never competes with the rows. */}
      {items.length > 0 && (
        <p className="text-muted-foreground bg-muted/40 border-b px-4 py-1.5 text-xs">
          <span className="text-foreground font-medium tabular-nums">
            {stats.active}
          </span>{' '}
          active of <span className="tabular-nums">{stats.total}</span> ·{' '}
          <span className="tabular-nums">{stats.categories}</span>{' '}
          {stats.categories === 1 ? 'category' : 'categories'} · avg{' '}
          <span className="tabular-nums">
            {stats.active > 0
              ? formatCurrencyPrecise(stats.averagePrice, defaultCurrency)
              : '—'}
          </span>
        </p>
      )}

      <section
        className="app-scrollbar fab-safe-area min-h-0 flex-1 overflow-y-auto overscroll-contain"
        aria-label="Catalog items"
      >
        {isLoading ? (
          // Row-shaped skeleton mirrors the list layout so nothing jumps
          // when catalog data lands (CLS ~0).
          <ListRowsSkeleton count={8} withAvatar={false} className="px-4" />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <Package
              className="text-muted-foreground size-8"
              aria-hidden="true"
            />
            <div>
              <p className="text-foreground font-medium">
                {items.length === 0
                  ? 'No catalog items yet'
                  : 'No matching items'}
              </p>
              <p className="text-muted-foreground mt-1 max-w-md text-sm">
                {items.length === 0
                  ? 'Add the services and products your team schedules and sells.'
                  : 'Adjust the filters or clear your search to see more results.'}
              </p>
            </div>
            {items.length === 0 ? (
              <Button onClick={openCreate}>
                <Plus aria-hidden="true" /> New item
              </Button>
            ) : (
              <Button variant="outline" onClick={clearFilters}>
                <SlidersHorizontal aria-hidden="true" /> Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-border divide-y">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="group hover:bg-muted/30 flex flex-col gap-3 px-4 py-3 transition-colors md:flex-row md:items-center md:px-6"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      item.isActive
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <Package className="size-4.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-foreground truncate text-sm font-semibold">
                      {item.name}
                    </h2>
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
                      'w-fit rounded-full border px-2.5 py-0.5 text-xs font-medium',
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
                          size="icon-sm"
                          // Always rendered, never hover-only: a
                          // hover-revealed control is unreachable on
                          // touch and invisible to keyboard users.
                          className="text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Actions for ${item.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => openEdit(item)}>
                        <Pencil />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void toggleActive(item)}>
                        {item.isActive ? <Archive /> : <ArchiveRestore />}
                        {item.isActive ? 'Archive' : 'Restore'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setPendingDelete(item)}
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
      </section>

      <CatalogRecordSheet
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
        onSaved={() => void mutate()}
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(next) => !next && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Delete &quot;{pendingDelete?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the item from your catalog. Appointments
              already booked against it keep their history. Archive it instead
              if you only want to stop new bookings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? 'Deleting…' : 'Delete item'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
