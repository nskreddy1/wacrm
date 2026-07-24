'use client';

// ============================================================
// MembersTab — Settings → Users and Controls (Bigin-style)
//
// Tabs: Users | Profiles | Roles | Workspace
//
//   Users    — status pills (Active / Inactive / Invited /
//              Deleted) + search + "+ New User". Table columns
//              mirror Bigin exactly: Full Name | Email | Role |
//              Profile. Role = hierarchy role (Level 1…),
//              Profile = permission set (Super Admin /
//              Administrator / Standard / custom).
//   Profiles — permission sets (WorkspaceProfilesTab).
//   Roles    — reporting hierarchy tree (WorkspaceRolesTab).
//   Workspace— rename card.
//
// Per the design annotations, this tab intentionally has NO
// heading, NO presence summary line, and NO role-count chips —
// the pills + table carry all state.
//
// Permission-gating
//   Mutations require members:manage (checked by `useCan` here
//   and re-checked server-side by the RPCs + RLS).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  Mail,
  MailX,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  UserRoundX,
  UsersRound,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { AccountMember } from '@/types';
import { personDisplayName } from '@/lib/display-name';
import {
  DataTable,
  FilterChips,
  SectionTabs,
  SectionToolbar,
} from '@/components/shared/section-view';
import { InviteUserSheet } from './invite-user-sheet';
import { VerifiedDomainsCard } from './verified-domains-card';
import { WorkspaceNameCard } from './workspace-name-card';
import { WorkspaceProfilesTab } from './workspace-profiles-tab';
import { WorkspaceRolesTab } from './workspace-roles-tab';

interface Invitation {
  id: string;
  label: string | null;
  created_at: string;
  expires_at: string;
  invited_email: string | null;
  invited_first_name: string | null;
  invited_last_name: string | null;
  workspace_profiles: { id: string; name: string } | null;
}

/** Whole-account status counts from the paginated members API. */
interface StatusSummary {
  active: number;
  inactive: number;
  deleted: number;
  invited: number;
}

type StatusFilter = 'active' | 'inactive' | 'invited' | 'deleted';

interface WorkspaceProfileOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 50;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtExpiresIn(
  iso: string,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('expired');
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return t('expiresInDays', { days });
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  return t('expiresInHours', { hours });
}

export function MembersTab() {
  const t = useTranslations('Settings.members');
  const { user, canManageMembers } = useAuth();

  const [members, setMembers] = useState<AccountMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [profileOptions, setProfileOptions] = useState<
    WorkspaceProfileOption[]
  >([]);
  const [summary, setSummary] = useState<StatusSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState<'users' | 'profiles' | 'roles' | 'workspace'>(
    'users'
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [confirmAction, setConfirmAction] = useState<{
    kind: 'deactivate' | 'delete' | 'reactivate';
    member: AccountMember;
  } | null>(null);
  const [pendingMemberAction, setPendingMemberAction] = useState<string | null>(
    null
  );

  // Monotonically increasing request id — a stale response arriving
  // after a newer one must not clobber the newer page.
  const requestSeq = useRef(0);

  const loadEverything = useCallback(
    async (q: string, status: StatusFilter) => {
      const seq = ++requestSeq.current;
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        // "invited" is not a member status — the pill swaps the table
        // for the invitations list; keep loading active members
        // underneath so counts stay warm.
        params.set('status', status === 'invited' ? 'active' : status);
        if (q) params.set('q', q);
        const [mres, ires, pres] = await Promise.all([
          fetch(`/api/account/members?${params}`, { cache: 'no-store' }),
          canManageMembers
            ? fetch('/api/account/invitations', { cache: 'no-store' })
            : Promise.resolve(null),
          canManageMembers
            ? fetch('/api/account/profiles', { cache: 'no-store' })
            : Promise.resolve(null),
        ]);
        if (seq !== requestSeq.current) return;

        if (!mres.ok) {
          const payload = await mres.json().catch(() => ({}));
          toast.error(payload.error || 'Failed to load members');
          return;
        }
        const mdata = (await mres.json()) as {
          members: AccountMember[];
          next_cursor: string | null;
          summary: StatusSummary;
        };
        if (seq !== requestSeq.current) return;
        setMembers(mdata.members);
        setNextCursor(mdata.next_cursor);
        setSummary(mdata.summary);

        if (ires) {
          if (ires.ok) {
            const idata = (await ires.json()) as { invitations: Invitation[] };
            setInvitations(idata.invitations);
          }
        } else {
          setInvitations([]);
        }
        if (pres && pres.ok) {
          const pdata = (await pres.json()) as {
            data?: (WorkspaceProfileOption & Record<string, unknown>)[];
            profiles?: (WorkspaceProfileOption & Record<string, unknown>)[];
          };
          // The profiles API returns { data }; tolerate legacy { profiles }.
          const list = pdata.data ?? pdata.profiles ?? [];
          setProfileOptions(list.map((p) => ({ id: p.id, name: p.name })));
        }
      } catch (err) {
        console.error('[MembersTab] load error:', err);
        toast.error('Could not reach the server');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [canManageMembers]
  );

  // Initial load + debounced server-side search (300ms).
  useEffect(() => {
    const timer = setTimeout(
      () => {
        void loadEverything(search.trim(), statusFilter);
      },
      search ? 300 : 0
    );
    return () => clearTimeout(timer);
  }, [search, statusFilter, loadEverything]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        cursor: nextCursor,
      });
      params.set(
        'status',
        statusFilter === 'invited' ? 'active' : statusFilter
      );
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
        members: AccountMember[];
        next_cursor: string | null;
      };
      setMembers((prev) => {
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
  }, [nextCursor, loadingMore, search, statusFilter]);

  /** PATCH a member's workspace profile (permission set). */
  async function handleProfileChange(member: AccountMember, profileId: string) {
    if (member.workspace_profile?.id === profileId) return;
    const previous = member.workspace_profile;
    const nextProfile = profileOptions.find((p) => p.id === profileId) ?? null;
    setPendingMemberAction(member.user_id);
    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === member.user_id
          ? { ...m, workspace_profile: nextProfile }
          : m
      )
    );
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceProfileId: profileId }),
      });
      if (!res.ok) {
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === member.user_id
              ? { ...m, workspace_profile: previous }
              : m
          )
        );
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to update profile');
        return;
      }
      toast.success(
        t('profileUpdatedToast', {
          name: member.full_name || t('unnamed'),
          profile: nextProfile?.name ?? '',
        })
      );
    } catch (err) {
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id
            ? { ...m, workspace_profile: previous }
            : m
        )
      );
      console.error('[MembersTab] profile change error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPendingMemberAction(null);
    }
  }

  /** PATCH a member's status (deactivate / reactivate / soft-delete). */
  async function handleStatusChange() {
    if (!confirmAction) return;
    const { kind, member } = confirmAction;
    const nextStatus =
      kind === 'deactivate'
        ? 'inactive'
        : kind === 'delete'
          ? 'deleted'
          : 'active';
    setPendingMemberAction(member.user_id);
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to update user');
        return;
      }
      toast.success(
        t(
          kind === 'deactivate'
            ? 'deactivatedToast'
            : kind === 'delete'
              ? 'deletedToast'
              : 'reactivatedToast',
          { name: member.full_name || t('unnamed') }
        )
      );
      // The row leaves the current status slice; refresh counts too.
      setConfirmAction(null);
      void loadEverything(search.trim(), statusFilter);
    } catch (err) {
      console.error('[MembersTab] status change error:', err);
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
      setSummary((prev) =>
        prev ? { ...prev, invited: Math.max(0, prev.invited - 1) } : prev
      );
    } catch (err) {
      console.error('[MembersTab] revoke error:', err);
      toast.error('Could not reach the server');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  const confirmCopy =
    confirmAction?.kind === 'deactivate'
      ? {
          title: t('deactivateDialogTitle'),
          desc: 'deactivateDialogDesc',
          btn: t('deactivateBtn'),
        }
      : confirmAction?.kind === 'delete'
        ? {
            title: t('deleteDialogTitle'),
            desc: 'deleteDialogDesc',
            btn: t('deleteBtn'),
          }
        : {
            title: t('reactivateDialogTitle'),
            desc: 'reactivateDialogDesc',
            btn: t('reactivateBtn'),
          };

  return (
    <section className="animate-in fade-in-50 space-y-5 duration-200">
      {/* Bigin-style top tab strip: Users | Profiles | Roles | Workspace. */}
      <SectionTabs
        tabs={[
          { id: 'users', label: t('tabUsers') },
          ...(canManageMembers
            ? [{ id: 'profiles', label: t('tabProfiles') }]
            : []),
          { id: 'roles', label: t('tabRoles') },
          { id: 'workspace', label: t('tabWorkspace') },
        ]}
        active={tab}
        onSelect={(id) => setTab(id as typeof tab)}
      />

      {tab === 'workspace' && (
        <div className="space-y-4">
          <WorkspaceNameCard />
          <VerifiedDomainsCard />
        </div>
      )}
      {tab === 'profiles' && canManageMembers && (
        <WorkspaceProfilesTab
          onChanged={() => void loadEverything(search.trim(), statusFilter)}
        />
      )}
      {tab === 'roles' && <WorkspaceRolesTab canManage={canManageMembers} />}

      {tab === 'users' && (
        <>
          {/* Status pills + search + New User (Bigin toolbar). */}
          <SectionToolbar
            left={
              <FilterChips
                chips={[
                  {
                    id: 'active',
                    label: t('statusActive'),
                    count: summary?.active,
                  },
                  {
                    id: 'inactive',
                    label: t('statusInactive'),
                    count: summary?.inactive,
                  },
                  ...(canManageMembers
                    ? [
                        {
                          id: 'invited',
                          label: t('statusInvited'),
                          count: summary?.invited,
                        },
                      ]
                    : []),
                  {
                    id: 'deleted',
                    label: t('statusDeleted'),
                    count: summary?.deleted,
                  },
                ]}
                active={statusFilter}
                onSelect={(id) => {
                  setStatusFilter(id as StatusFilter);
                  setLoading(true);
                }}
              />
            }
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('searchPlaceholder')}
            action={
              canManageMembers ? (
                <Button onClick={() => setInviteOpen(true)}>
                  <Plus className="size-4" />
                  {t('newUser')}
                </Button>
              ) : null
            }
          />

          {/* Invited pill → invitations list instead of member rows. */}
          {statusFilter === 'invited' ? (
            <DataTable<Invitation>
              rows={invitations}
              rowKey={(inv) => inv.id}
              empty={
                <span className="inline-flex flex-col items-center gap-2">
                  <Mail className="size-6" />
                  {t('noPendingTitle')}
                </span>
              }
              columns={[
                {
                  id: 'name',
                  header: t('colName'),
                  className: 'w-[34%]',
                  cell: (inv) => {
                    const name = [inv.invited_first_name, inv.invited_last_name]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-8 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                            {(name || inv.invited_email || inv.label || 'U')
                              .charAt(0)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-foreground truncate font-medium">
                          {name || inv.label || t('untitledInvite')}
                        </span>
                      </div>
                    );
                  },
                },
                {
                  id: 'email',
                  header: t('colEmail'),
                  className: 'w-[30%]',
                  cell: (inv) => (
                    <span className="text-muted-foreground truncate">
                      {inv.invited_email ?? '—'}
                    </span>
                  ),
                },
                {
                  id: 'profile',
                  header: t('colProfile'),
                  cell: (inv) => (
                    <span className="text-foreground">
                      {inv.workspace_profiles?.name ?? '—'}
                    </span>
                  ),
                },
                {
                  id: 'expires',
                  header: t('colExpires'),
                  cell: (inv) => (
                    <span className="text-muted-foreground text-xs">
                      {t('created', { date: fmtDate(inv.created_at) })} ·{' '}
                      {fmtExpiresIn(inv.expires_at, t)}
                    </span>
                  ),
                },
                {
                  id: 'actions',
                  header: <span className="sr-only">{t('colActions')}</span>,
                  className: 'w-12 text-right',
                  cell: (inv) => (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(inv)}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      <MailX className="size-4" />
                      {t('revoke')}
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <>
              {/* Users table — Bigin columns: Full Name | Email | Role | Profile. */}
              <DataTable<AccountMember>
                rows={members}
                rowKey={(m) => m.user_id}
                empty={
                  <span className="inline-flex flex-col items-center gap-2">
                    <UsersRound className="size-6" />
                    {search.trim()
                      ? t('noSearchResults')
                      : t('memberCount', { count: 0 })}
                  </span>
                }
                columns={[
                  {
                    id: 'name',
                    header: t('colName'),
                    className: 'w-[30%]',
                    cell: (member) => {
                      const isSelf = member.user_id === user?.id;
                      return (
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="size-8 shrink-0">
                            {member.avatar_url ? (
                              <AvatarImage
                                src={member.avatar_url}
                                alt={member.full_name || 'Member'}
                              />
                            ) : null}
                            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                              {(member.full_name || member.email || 'U')
                                .charAt(0)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-foreground truncate font-medium">
                            {personDisplayName(member.full_name, member.email)}
                          </span>
                          {isSelf && (
                            <Badge className="bg-muted text-muted-foreground border-border text-[10px] tracking-wide uppercase">
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
                    className: 'w-[32%]',
                    cell: (member) => (
                      <span className="text-muted-foreground truncate">
                        {member.email ?? '—'}
                      </span>
                    ),
                  },
                  {
                    id: 'role',
                    header: t('colRole'),
                    className: 'w-[16%]',
                    cell: (member) => (
                      <span className="text-foreground">
                        {member.workspace_role?.name ?? '—'}
                      </span>
                    ),
                  },
                  {
                    id: 'profile',
                    header: t('colProfile'),
                    className: 'w-[16%]',
                    cell: (member) => {
                      const isSelf = member.user_id === user?.id;
                      const isBusy = pendingMemberAction === member.user_id;
                      // Owner is the immutable Super Admin; self can't
                      // edit own profile; non-managers see text only.
                      if (member.is_owner) {
                        return (
                          <span className="text-foreground font-medium">
                            {t('superAdmin')}
                          </span>
                        );
                      }
                      if (
                        !canManageMembers ||
                        isSelf ||
                        statusFilter !== 'active'
                      ) {
                        return (
                          <span className="text-foreground">
                            {member.workspace_profile?.name ?? '—'}
                          </span>
                        );
                      }
                      return (
                        <Select
                          value={member.workspace_profile?.id ?? ''}
                          onValueChange={(v) =>
                            v && handleProfileChange(member, v)
                          }
                        >
                          <SelectTrigger className="w-40" disabled={isBusy}>
                            {/* Explicit children so a not-yet-loaded option
                                list can never surface the raw UUID value. */}
                            <SelectValue placeholder="—">
                              {member.workspace_profile?.name ?? '—'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {profileOptions.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    },
                  },
                  {
                    id: 'actions',
                    header: <span className="sr-only">{t('colActions')}</span>,
                    className: 'w-12 text-right',
                    cell: (member) => {
                      const isSelf = member.user_id === user?.id;
                      const isBusy = pendingMemberAction === member.user_id;
                      if (!canManageMembers || member.is_owner || isSelf)
                        return null;
                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isBusy}
                                aria-label={t('colActions')}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            {member.status === 'active' && (
                              <DropdownMenuItem
                                onClick={() =>
                                  setConfirmAction({
                                    kind: 'deactivate',
                                    member,
                                  })
                                }
                              >
                                <UserRoundX className="size-4" />
                                {t('deactivateBtn')}
                              </DropdownMenuItem>
                            )}
                            {(member.status === 'inactive' ||
                              member.status === 'deleted') && (
                              <DropdownMenuItem
                                onClick={() =>
                                  setConfirmAction({
                                    kind: 'reactivate',
                                    member,
                                  })
                                }
                              >
                                <RotateCcw className="size-4" />
                                {t('reactivateBtn')}
                              </DropdownMenuItem>
                            )}
                            {member.status !== 'deleted' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    setConfirmAction({ kind: 'delete', member })
                                  }
                                >
                                  <Trash2 className="size-4" />
                                  {t('deleteBtn')}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
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
        </>
      )}

      <InviteUserSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={() => void loadEverything(search.trim(), statusFilter)}
      />

      {/* Confirm deactivate / reactivate / soft-delete. */}
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-400" />
              {confirmCopy.title}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {confirmAction
                ? t.rich(confirmCopy.desc, {
                    name: confirmAction.member.full_name || t('unnamed'),
                    bold: (chunks: React.ReactNode) => (
                      <strong>{chunks}</strong>
                    ),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setConfirmAction(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleStatusChange}
              disabled={!!pendingMemberAction}
              className={
                confirmAction?.kind === 'reactivate'
                  ? undefined
                  : 'bg-red-600 text-white hover:bg-red-700'
              }
            >
              {pendingMemberAction ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('working')}
                </>
              ) : (
                confirmCopy.btn
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
