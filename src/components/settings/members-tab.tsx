'use client';

// ============================================================
// MembersTab — Settings → Members
//
// Two stacked sections:
//   1. Roster   — every member of the account. Admin+ can change a
//                 teammate's role inline and remove them. Owner row
//                 is non-editable everywhere (transfer is its own
//                 separate flow, deferred to a later PR).
//   2. Pending  — outstanding invite links. Admin+ can revoke. The
//                 plaintext URL is gone after the create dialog
//                 closes, so we surface a "revoke + new link" hint
//                 rather than pretending we can resurface it.
//
// Role-gating
//   The tab itself is reachable by any member, but mutation buttons
//   are wrapped in `<RequireRole min="admin">` / `useCan` so an
//   agent or viewer sees the roster read-only. The server-side
//   RPCs (set_member_role, remove_account_member) double-check
//   the role anyway.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  Mail,
  MailX,
  Plus,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react';

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import type { AccountRole } from '@/lib/auth/roles';
import { personDisplayName } from '@/lib/display-name';
import { presenceLabel, summarize } from '@/lib/presence';
import {
  PRESENCE_DOT_CLASS,
  PresenceDot,
} from '@/components/presence/presence-dot';
import {
  DataTable,
  FilterChips,
  SectionTabs,
  SectionToolbar,
} from '@/components/shared/section-view';
import { InviteMemberDialog } from './invite-member-dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { WorkspaceNameCard } from './workspace-name-card';
import { ROLE_META } from './role-meta';

interface Member {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  role: AccountRole;
  joined_at: string;
}

interface Invitation {
  id: string;
  role: 'admin' | 'agent' | 'viewer';
  label: string | null;
  created_at: string;
  expires_at: string;
}

/** Whole-account role counts from the paginated members API. */
interface RoleSummary {
  total: number;
  owner: number;
  admin: number;
  agent: number;
  viewer: number;
}

const PAGE_SIZE = 50;

// These roles are translated via `useTranslations("Settings.roles")` where they are used.
const EDITABLE_ROLES: { value: AccountRole }[] = [
  { value: 'admin' },
  { value: 'agent' },
  { value: 'viewer' },
];

// Per-role chip metadata (icon / label / colour) lives in the shared
// ROLE_META module so this roster and the Overview identity chip can't
// drift. The colour scale runs amber (owner — scarce, immutable) →
// primary (admin) → muted (agent / viewer).

function fmtDate(iso: string): string {
  // Match the rest of the dashboard's locale-light formatting.
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtExpiresIn(iso: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('expired');
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return t('expiresInDays', { days });
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  return t('expiresInHours', { hours });
}

export function MembersTab() {
  const t = useTranslations('Settings.members');
  const tRoles = useTranslations('Settings.roles');
  const { user, canManageMembers } = useAuth();
  const { getPresence, getRow, now } = usePresence();

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [summary, setSummary] = useState<RoleSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  // Bigin-style section state — top tab strip + role filter chips.
  const [tab, setTab] = useState<'users' | 'roles' | 'workspace' | 'invitations'>('users');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admins' | 'agent' | 'viewer'>('all');
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const [pendingMemberAction, setPendingMemberAction] = useState<string | null>(
    null,
  );

  // Monotonically increasing request id — a stale search response
  // arriving after a newer one must not clobber the newer page.
  const requestSeq = useRef(0);

  const loadEverything = useCallback(
    async (q: string) => {
      const seq = ++requestSeq.current;
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (q) params.set('q', q);
        const [mres, ires] = await Promise.all([
          fetch(`/api/account/members?${params}`, { cache: 'no-store' }),
          canManageMembers
            ? fetch('/api/account/invitations', { cache: 'no-store' })
            : Promise.resolve(null),
        ]);
        if (seq !== requestSeq.current) return;

        if (!mres.ok) {
          const payload = await mres.json().catch(() => ({}));
          toast.error(payload.error || 'Failed to load members');
          return;
        }
        const mdata = (await mres.json()) as {
          members: Member[];
          next_cursor: string | null;
          summary: RoleSummary;
        };
        if (seq !== requestSeq.current) return;
        setMembers(mdata.members);
        setNextCursor(mdata.next_cursor);
        setSummary(mdata.summary);

        if (ires) {
          if (!ires.ok) {
            const payload = await ires.json().catch(() => ({}));
            toast.error(payload.error || 'Failed to load invitations');
            return;
          }
          const idata = (await ires.json()) as { invitations: Invitation[] };
          setInvitations(idata.invitations);
        } else {
          setInvitations([]);
        }
      } catch (err) {
        console.error('[MembersTab] load error:', err);
        toast.error('Could not reach the server');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [canManageMembers],
  );

  // Initial load + debounced server-side search (300ms).
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadEverything(search.trim());
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, loadEverything]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        cursor: nextCursor,
      });
      const q = search.trim();
      if (q) params.set('q', q);
      const res = await fetch(`/api/account/members?${params}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load more members');
        return;
      }
      const data = (await res.json()) as {
        members: Member[];
        next_cursor: string | null;
      };
      setMembers((prev) => {
        // Dedupe defensively: a role change between pages could shift
        // keyset boundaries and repeat a row.
        const seen = new Set(prev.map((m) => m.user_id));
        return [...prev, ...data.members.filter((m) => !seen.has(m.user_id))];
      });
      setNextCursor(data.next_cursor);
    } catch (err) {
      console.error('[MembersTab] load more error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, search]);

  async function handleRoleChange(member: Member, nextRole: AccountRole) {
    if (member.role === nextRole) return;
    // Optimistic update — flip the dropdown immediately so the UI
    // feels snappy. If the server PATCH fails we revert below so
    // the dropdown doesn't lie about the persisted state.
    const previousRole = member.role;
    setPendingMemberAction(member.user_id);
    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === member.user_id ? { ...m, role: nextRole } : m,
      ),
    );
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        // Revert the optimistic flip. The toast on its own wasn't
        // enough — the dropdown was left showing the new role
        // forever, so the next interaction operated on a wrong
        // baseline (re-trying the same change would no-op via the
        // `member.role === nextRole` guard at the top).
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === member.user_id ? { ...m, role: previousRole } : m,
          ),
        );
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to update role');
        return;
      }
      // Keep the whole-account role counts honest without a refetch.
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              [previousRole]: Math.max(0, prev[previousRole] - 1),
              [nextRole]: prev[nextRole] + 1,
            }
          : prev,
      );
      toast.success(t('updatedToast', { name: member.full_name || t('unnamed'), role: tRoles(nextRole) }));
    } catch (err) {
      // Same revert on network failure.
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id ? { ...m, role: previousRole } : m,
        ),
      );
      console.error('[MembersTab] role change error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPendingMemberAction(null);
    }
  }

  async function handleRemove() {
    if (!removingMember) return;
    setPendingMemberAction(removingMember.user_id);
    try {
      const res = await fetch(
        `/api/account/members/${removingMember.user_id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to remove member');
        return;
      }
      toast.success(t('removedToast', { name: removingMember.full_name || t('unnamed') }));
      setMembers((prev) =>
        prev.filter((m) => m.user_id !== removingMember.user_id),
      );
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              total: Math.max(0, prev.total - 1),
              [removingMember.role]: Math.max(0, prev[removingMember.role] - 1),
            }
          : prev,
      );
      setRemovingMember(null);
    } catch (err) {
      console.error('[MembersTab] remove error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPendingMemberAction(null);
    }
  }

  async function handleRevoke(invite: Invitation) {
    try {
      const res = await fetch(`/api/account/invitations/${invite.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to revoke invitation');
        return;
      }
      toast.success(t('revokedToast'));
      setInvitations((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      console.error('[MembersTab] revoke error:', err);
      toast.error('Could not reach the server');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Bigin-style top tab strip: Users | Roles | Workspace | Invitations. */}
      <SectionTabs
        tabs={[
          { id: 'users', label: t('tabUsers'), badge: summary?.total },
          { id: 'roles', label: t('tabRoles') },
          { id: 'workspace', label: t('tabWorkspace') },
          ...(canManageMembers
            ? [{ id: 'invitations', label: t('pendingInvitations'), badge: invitations.length }]
            : []),
        ]}
        active={tab}
        onSelect={(id) => setTab(id as typeof tab)}
      />

      {/* Workspace identity — rename on its own tab (annotation #3). */}
      {tab === 'workspace' && <WorkspaceNameCard />}

      {/* Roles — DB-backed reporting hierarchy, admin-managed. */}
      {tab === 'roles' && <WorkspaceRolesTab canManage={canManageMembers} />}

      {tab === 'users' && (
        <SectionToolbar
          left={
            <FilterChips
              chips={[
                { id: 'all', label: t('statTotal'), count: summary?.total },
                { id: 'admins', label: t('statAdmins'), count: summary ? summary.owner + summary.admin : undefined },
                { id: 'agent', label: tRoles('agent'), count: summary?.agent },
                { id: 'viewer', label: tRoles('viewer'), count: summary?.viewer },
              ]}
              active={roleFilter}
              onSelect={(id) => setRoleFilter(id as typeof roleFilter)}
            />
          }
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('searchPlaceholder')}
          action={
            <RequireRole min="admin">
              <Button onClick={() => setInviteOpen(true)}>
                <Plus className="size-4" />
                {t('inviteMember')}
              </Button>
            </RequireRole>
          }
        />
      )}

      {/* Live presence summary across the roster. Updates without a
          full refresh as heartbeats and the local re-derive tick land. */}
      {tab === 'users' && members.length > 0 &&
        (() => {
          const counts = summarize(members.map((m) => getPresence(m.user_id)));
          return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <PresenceDot status="online" />
                {counts.online} {t('online')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <PresenceDot status="away" />
                {counts.away} {t('away')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <PresenceDot status="offline" />
                {counts.offline} {t('offline')}
              </span>
              <span className="text-muted-foreground/70">
                · {t('memberCount', { count: summary?.total ?? members.length })}
              </span>
            </div>
          );
        })()}

      {/* Roster — Bigin-style generic DataTable. Role filter chips
          slice the loaded rows client-side; search stays server-side. */}
      {tab === 'users' && (
        <>
          <DataTable<Member>
            rows={members.filter((m) =>
              roleFilter === 'all'
                ? true
                : roleFilter === 'admins'
                  ? m.role === 'owner' || m.role === 'admin'
                  : m.role === roleFilter,
            )}
            rowKey={(m) => m.user_id}
            empty={
              <span className="inline-flex flex-col items-center gap-2">
                <UsersRound className="size-6" />
                {search.trim() ? t('noSearchResults') : t('memberCount', { count: 0 })}
              </span>
            }
            columns={[
              {
                id: 'name',
                header: t('colName'),
                className: 'w-[34%]',
                cell: (member) => {
                  const presence = getPresence(member.user_id);
                  const presenceRow = getRow(member.user_id);
                  const presenceText = presenceLabel(
                    presence,
                    presenceRow?.last_seen_at ?? null,
                    now,
                  );
                  const isSelf = member.user_id === user?.id;
                  return (
                    <div className="flex min-w-0 items-center gap-3">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Avatar className="size-8 shrink-0">
                              {member.avatar_url ? (
                                <AvatarImage
                                  src={member.avatar_url}
                                  alt={member.full_name || 'Member'}
                                />
                              ) : null}
                              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                                {(member.full_name || member.email || 'U')
                                  .charAt(0)
                                  .toUpperCase()}
                              </AvatarFallback>
                              <AvatarBadge
                                role="img"
                                aria-label={presenceText}
                                className={PRESENCE_DOT_CLASS[presence]}
                              />
                            </Avatar>
                          }
                        />
                        <TooltipContent>{presenceText}</TooltipContent>
                      </Tooltip>
                      <span className="truncate font-medium text-foreground">
                        {personDisplayName(member.full_name, member.email)}
                      </span>
                      {isSelf && (
                        <Badge className="bg-muted text-muted-foreground border-border text-[10px] uppercase tracking-wide">
                          {t('you')}
                        </Badge>
                      )}
                    </div>
                  );
                },
              },
              {
                id: 'email',
                header: t('colEmail'),
                className: 'w-[30%]',
                cell: (member) => (
                  <span className="truncate text-muted-foreground">{member.email ?? '—'}</span>
                ),
              },
              {
                id: 'role',
                header: t('colRole'),
                cell: (member) => {
                  const roleMeta = ROLE_META[member.role];
                  const RoleIcon = roleMeta.icon;
                  const isSelf = member.user_id === user?.id;
                  const isOwnerRow = member.role === 'owner';
                  const isBusy = pendingMemberAction === member.user_id;
                  return canManageMembers && !isOwnerRow && !isSelf ? (
                    <Select
                      value={member.role}
                      onValueChange={(v) =>
                        v && handleRoleChange(member, v as AccountRole)
                      }
                    >
                      <SelectTrigger
                        className="w-32 bg-muted border-border text-foreground"
                        disabled={isBusy}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EDITABLE_ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {tRoles(r.value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${roleMeta.className}`}
                    >
                      <RoleIcon className="size-3.5" />
                      {tRoles(member.role)}
                    </span>
                  );
                },
              },
              {
                id: 'joined',
                header: t('colJoined'),
                className: 'hidden md:table-cell',
                cell: (member) => (
                  <span className="text-xs text-muted-foreground">{fmtDate(member.joined_at)}</span>
                ),
              },
              {
                id: 'actions',
                header: <span className="sr-only">{t('colActions')}</span>,
                className: 'w-12 text-right',
                cell: (member) => {
                  const isSelf = member.user_id === user?.id;
                  const isOwnerRow = member.role === 'owner';
                  const isBusy = pendingMemberAction === member.user_id;
                  return canManageMembers && !isOwnerRow && !isSelf ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRemovingMember(member)}
                      disabled={isBusy}
                      aria-label={t('removeBtn')}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null;
                },
              },
            ]}
          />
          {nextCursor && (
            <div className="text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('loadingMore')}
                  </>
                ) : (
                  t('loadMore')
                )}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Pending invitations — admin+ only, on their own tab */}
      {tab === 'invitations' && (
      <RequireRole min="admin">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <UsersRound className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('pendingInvitations')}
            </h3>
            <Badge className="bg-muted text-muted-foreground border-border">
              {invitations.length}
            </Badge>
          </div>
          {/* P10 — make the no-resend design explicit. Admins were
              confused why the pending list shows roles + expiry but
              no "copy link again" button. Stating the constraint up
              front (rather than letting the user discover it by
              looking for a button) keeps it from feeling like a bug. */}
          {invitations.length > 0 ? (
            <p className="mb-3 text-xs text-muted-foreground">
              {t('inviteHint')}
            </p>
          ) : null}

          {invitations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <Mail className="size-6 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('noPendingTitle')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.rich('noPendingDesc', { bold: (chunks) => <strong>{chunks}</strong> })}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {invitations.map((inv) => {
                    const inviteRoleMeta = ROLE_META[inv.role];
                    const InviteRoleIcon = inviteRoleMeta.icon;
                    return (
                    <li
                      key={inv.id}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {inv.label || t('untitledInvite')}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${inviteRoleMeta.className}`}
                          >
                            <InviteRoleIcon className="size-3" />
                            {tRoles(inv.role)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('created', { date: fmtDate(inv.created_at) })} · {fmtExpiresIn(inv.expires_at, t)}
                        </p>
                      </div>

                      {/* Revoke: red default state, mirrors the
                          members-tab Remove button. Pre-polish version
                          read as a neutral secondary button until
                          hover. */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevoke(inv)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                      >
                        <MailX className="size-4" />
                        {t('revoke')}
                      </Button>
                    </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </RequireRole>
      )}

      <InviteUserSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={() => void loadEverything(search.trim())}
      />

      <Dialog
        open={removingMember !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingMember(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              {t('removeDialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t.rich('removeDialogDesc', { 
                name: removingMember?.full_name || t('unnamed'),
                bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setRemovingMember(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleRemove}
              disabled={!!pendingMemberAction}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {pendingMemberAction ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('removing')}
                </>
              ) : (
                t('removeBtn')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
