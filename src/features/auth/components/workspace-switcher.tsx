'use client';

// ============================================================
// Sidebar workspace switcher (ADR-004 decision D3).
//
// A user can be an active member of several workspaces — their own,
// plus any they were invited into. `profiles.account_id` is the
// *active* pointer; this control re-points it.
//
// Security model: the list rendered here is DISPLAY DATA ONLY. It
// comes from `account_members` filtered by RLS, but the switch is
// authorised entirely server-side — `POST /api/account/switch` calls
// `switch_active_account()`, which re-verifies active membership and
// returns 404 for a non-member. Tampering with this list in devtools
// therefore gains nothing.
//
// After a successful switch we do a FULL document navigation rather
// than a router.push: every RSC payload, SWR cache entry, and realtime
// subscription in the tree is scoped to the previous account, so a
// soft transition would leave the old workspace's contacts and deals
// on screen under the new workspace's name. A hard load is the only
// way to guarantee no cross-tenant bleed in the UI.
// ============================================================

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';

import { AxonMark } from '@/features/brand/components/axon-logo';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { AccountRole } from '@/features/auth/lib/roles';
import type { SessionMembership } from '@/features/auth/lib/session-payload';
import { workspaceDisplayName } from '@/lib/display-name';
import { routes } from '@/lib/routing/routes';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SidebarMenuButton, useSidebar } from '@/components/ui/sidebar';

/** Show the filter field only once scanning the list gets tedious. */
const SEARCH_THRESHOLD = 6;

/**
 * Membership-role labels. Mirrors the map in the /join page — these are
 * the coarse account roles (`account_members.role`), NOT the per-workspace
 * hierarchy roles ("Level 1") or permission profiles ("Standard") shown
 * in Settings, which are workspace-scoped and irrelevant here.
 */
const ROLE_LABEL: Record<AccountRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  agent: 'Agent',
  viewer: 'Viewer',
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || 'W';
}

export function WorkspaceSwitcher() {
  const { memberships, accountId } = useAuth();
  const { isMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Which row is mid-switch, so only that row shows a spinner.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active =
    memberships.find((m) => m.accountId === accountId) ?? memberships[0];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memberships;
    return memberships.filter((m) =>
      workspaceDisplayName(m.accountName).toLowerCase().includes(q)
    );
  }, [memberships, query]);

  async function selectWorkspace(m: SessionMembership) {
    // No-op fast path mirrors the endpoint's own: closing is the only
    // sensible response to picking the workspace you're already in.
    if (m.accountId === accountId) {
      setOpen(false);
      return;
    }
    setPendingId(m.accountId);
    setError(null);
    try {
      const res = await fetch('/api/account/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: m.accountId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        // Surface the server's reason (revoked membership, rate limit)
        // instead of a generic failure — the user can act on "you no
        // longer have access" but not on "something went wrong".
        setError(body?.error ?? 'Could not switch workspace.');
        setPendingId(null);
        return;
      }
      // Full reload — see the header note on cross-tenant cache bleed.
      window.location.assign(routes.app.dashboard);
    } catch {
      setError('Network error. Please try again.');
      setPendingId(null);
    }
  }

  const activeName = workspaceDisplayName(active?.accountName);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset transient state so reopening never shows a stale filter
        // or a resolved error from the previous attempt.
        if (!next) {
          setQuery('');
          setError(null);
        }
      }}
    >
      <PopoverTrigger
        render={
          <SidebarMenuButton
            size="lg"
            aria-label={`Current workspace: ${activeName}. Switch workspace`}
            className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
          />
        }
      >
        {/* The brand mark stays the sidebar's anchor — identical to the
            single-workspace BrandHeader, so gaining a second workspace
            changes what the row DOES, never what the product looks
            like. Per-workspace identity is carried by the name and the
            role badge; the popover rows use initials to tell workspaces
            apart, which is not this row's job. */}
        <span className="text-sidebar-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <AxonMark size={26} variant="mono" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="truncate text-sm font-semibold">{activeName}</span>
          {active && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {ROLE_LABEL[active.role]}
            </Badge>
          )}
        </span>
        <ChevronsUpDown className="ml-auto size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent
        side={isMobile ? 'bottom' : 'right'}
        align="start"
        className="w-72 p-0"
      >
        {memberships.length >= SEARCH_THRESHOLD && (
          <div className="relative border-b p-2">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find workspace..."
              aria-label="Find workspace"
              className="h-9 pl-8"
            />
          </div>
        )}

        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="text-muted-foreground px-3 py-6 text-center text-sm">
              No workspace matches &ldquo;{query}&rdquo;
            </li>
          ) : (
            filtered.map((m) => {
              const isActive = m.accountId === accountId;
              const name = workspaceDisplayName(m.accountName);
              const isPending = pendingId === m.accountId;
              return (
                <li key={m.accountId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    // Any pending switch locks the whole list: a second
                    // click mid-navigation would race two switches and
                    // land the user in a nondeterministic workspace.
                    disabled={pendingId !== null}
                    onClick={() => void selectWorkspace(m)}
                    className={cn(
                      'hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                      'focus-visible:ring-ring outline-none focus-visible:ring-2',
                      pendingId !== null && 'pointer-events-none opacity-60'
                    )}
                  >
                    <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold">
                      {initialsOf(name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {ROLE_LABEL[m.role]}
                    </Badge>
                    {isPending ? (
                      <Loader2
                        className="size-4 shrink-0 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Check
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'opacity-100' : 'opacity-0'
                        )}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {error && (
          <p
            role="alert"
            className="text-destructive border-t px-3 py-2 text-xs"
          >
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
