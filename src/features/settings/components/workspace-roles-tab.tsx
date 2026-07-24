'use client';

// ============================================================
// WorkspaceRolesTab — Bigin-style "Roles" tab.
//
// Roles form a reporting hierarchy ("Reports to"): a user on a
// lower role can't view records of users above them. This scales
// to workspaces with 100+ people because access is defined once
// per ROLE (a named, DB-stored row) instead of per user — admins
// assign a role at invite time and edit the role to change
// everyone at once.
//
//   • Tree list with Expand All / Collapse All (like Bigin).
//   • "New Role" opens a right-side sheet (same generic pattern
//     as Create Deal / Create Contact) with Role Name, Reports
//     to, Peer Data Visibility, and Description.
//   • Admin-only writes are enforced by RLS on workspace_roles;
//     system seeds (Level 1 / Level 2) can't be deleted.
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  RecordField,
  RecordLookup,
  RecordSheet,
} from '@/components/shared/record-sheet';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/hooks/use-auth';

interface WorkspaceRole {
  id: string;
  name: string;
  description: string | null;
  parent_role_id: string | null;
  peer_visibility: boolean;
  is_system: boolean;
}

export function WorkspaceRolesTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations('Settings.members');
  const { profile } = useAuth();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState<WorkspaceRole | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Create-sheet fields (Bigin: Role Name / Reports to / Peer Data
  // Visibility / Description).
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [peerVisibility, setPeerVisibility] = useState(true);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // SWR owns fetch/loading state; the key is null until the profile
  // resolves, which pauses fetching (no manual load effect needed).
  const {
    data: roles = [],
    isLoading: loading,
    mutate,
  } = useSWR(
    profile?.account_id
      ? (['workspace-roles', profile.account_id] as const)
      : null,
    async ([, accountId]) => {
      const supabase = createClient();
      const { data } = await supabase
        .from('workspace_roles')
        .select(
          'id, name, description, parent_role_id, peer_visibility, is_system'
        )
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
      return (data ?? []) as WorkspaceRole[];
    }
  );
  const load = useCallback(() => mutate(), [mutate]);

  // Children lookup for the tree render. Roles whose parent was
  // deleted (SET NULL) surface as roots so nothing disappears.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, WorkspaceRole[]>();
    const ids = new Set(roles.map((r) => r.id));
    for (const role of roles) {
      const key =
        role.parent_role_id && ids.has(role.parent_role_id)
          ? role.parent_role_id
          : null;
      const list = map.get(key) ?? [];
      list.push(role);
      map.set(key, list);
    }
    return map;
  }, [roles]);

  function resetSheet() {
    setName('');
    setParentId('');
    setPeerVisibility(true);
    setDescription('');
    setSaving(false);
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('roleNameRequired'));
      return;
    }
    if (!profile?.account_id) return;
    setSaving(true);
    try {
      const supabase = createClient();
      // RLS: insert allowed only for owner/admin of this account.
      const { error } = await supabase.from('workspace_roles').insert({
        account_id: profile.account_id,
        name: trimmed,
        description: description.trim() || null,
        parent_role_id: parentId || null,
        peer_visibility: peerVisibility,
        created_by_user_id: profile.id,
      });
      if (error) {
        toast.error(error.message || t('roleCreateFailed'));
        return;
      }
      toast.success(t('roleCreatedToast', { name: trimmed }));
      setSheetOpen(false);
      resetSheet();
      void load();
    } catch (err) {
      console.error('[WorkspaceRolesTab] create error:', err);
      toast.error(t('roleCreateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const supabase = createClient();
      // RLS: system roles and non-admin deletes are rejected.
      const { error } = await supabase
        .from('workspace_roles')
        .delete()
        .eq('id', deleting.id);
      if (error) {
        toast.error(error.message || t('roleDeleteFailed'));
        return;
      }
      toast.success(t('roleDeletedToast', { name: deleting.name }));
      setDeleting(null);
      void load();
    } catch (err) {
      console.error('[WorkspaceRolesTab] delete error:', err);
      toast.error(t('roleDeleteFailed'));
    } finally {
      setDeleteBusy(false);
    }
  }

  function renderNode(role: WorkspaceRole, depth: number) {
    const children = childrenOf.get(role.id) ?? [];
    const isCollapsed = collapsed.has(role.id);
    return (
      <div key={role.id}>
        <div
          className="group hover:bg-muted/60 flex items-center gap-2 rounded-md px-2 py-2"
          style={{ paddingLeft: `${depth * 28 + 8}px` }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(role.id)) next.delete(role.id);
                  else next.add(role.id);
                  return next;
                })
              }
              className="border-border text-muted-foreground hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded border"
              aria-label={isCollapsed ? t('expandAll') : t('collapseAll')}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
          ) : (
            <span
              className="border-border/70 size-5 shrink-0 border-l border-dashed"
              aria-hidden
            />
          )}

          <span className="text-foreground text-sm font-medium">
            {role.name}
          </span>
          {role.is_system && (
            <Badge variant="secondary" className="text-[10px]">
              {t('roleSystemBadge')}
            </Badge>
          )}
          {role.description && (
            <span className="text-muted-foreground hidden truncate text-xs sm:inline">
              — {role.description}
            </span>
          )}

          {canManage && !role.is_system && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive ml-auto size-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => setDeleting(role)}
              aria-label={t('roleDeleteBtn')}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
        {!isCollapsed && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf.get(null) ?? [];

  return (
    <section className="animate-in fade-in-50">
      {/* Expand / collapse controls left, New Role action right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="text-primary font-medium hover:underline"
          >
            {t('expandAll')}
          </button>
          <span className="text-border">·</span>
          <button
            type="button"
            onClick={() => setCollapsed(new Set(roles.map((r) => r.id)))}
            className="text-primary font-medium hover:underline"
          >
            {t('collapseAll')}
          </button>
        </div>
        {canManage && (
          <Button
            onClick={() => setSheetOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t('newRole')}
          </Button>
        )}
      </div>

      {/* Role hierarchy tree */}
      <div className="mt-2">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : roots.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-sm">
            {t('noRoles')}
          </p>
        ) : (
          roots.map((role) => renderNode(role, 0))
        )}
      </div>

      {/* Create New Role — generic RecordSheet, the same primitive that
          Create Deal / Create Contact use, so all record editors match. */}
      <RecordSheet
        open={sheetOpen}
        title={t('createRoleTitle')}
        description={t('rolesDesc')}
        saving={saving}
        isCreate
        onOpenChange={(next) => {
          if (!next) resetSheet();
          setSheetOpen(next);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <RecordField label={t('roleNameLabel')} htmlFor="role-name">
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="h-11"
          />
        </RecordField>

        <RecordField label={t('reportsToLabel')} htmlFor="role-reports-to">
          <RecordLookup
            id="role-reports-to"
            value={parentId || null}
            options={roles.map((r) => ({ id: r.id, label: r.name }))}
            placeholder={t('selectPlaceholder')}
            icon={
              <Share2
                className="text-muted-foreground size-4 shrink-0 rotate-90"
                aria-hidden="true"
              />
            }
            onSelect={(id) => setParentId(id ?? '')}
          />
        </RecordField>

        <RecordField
          label={t('peerVisibilityLabel')}
          htmlFor="role-peer-visibility"
        >
          <div className="bg-muted/50 flex min-h-11 items-center gap-2 rounded-md px-3">
            <Switch
              id="role-peer-visibility"
              checked={peerVisibility}
              onCheckedChange={setPeerVisibility}
            />
            <span className="text-foreground text-sm">
              {t('peerVisibilityText')}
            </span>
          </div>
        </RecordField>

        <RecordField label={t('descriptionLabel')} htmlFor="role-description">
          <Textarea
            id="role-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('descPlaceholder')}
            maxLength={500}
            rows={3}
          />
        </RecordField>
      </RecordSheet>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('roleDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich('roleDeleteDesc', {
                name: deleting?.name ?? '',
                bold: (chunks) => (
                  <span className="text-foreground font-semibold">
                    {chunks}
                  </span>
                ),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleteBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy ? t('roleDeleting') : t('roleDeleteBtn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
