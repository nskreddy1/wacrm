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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

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

  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    if (!profile?.account_id) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('workspace_roles')
      .select('id, name, description, parent_role_id, peer_visibility, is_system')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: true });
    setRoles(data ?? []);
    setLoading(false);
  }, [profile?.account_id]);

  useEffect(() => {
    void load();
  }, [load]);

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
          className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
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
              className="flex size-5 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
              aria-label={isCollapsed ? t('expandAll') : t('collapseAll')}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0 border-l border-dashed border-border/70" aria-hidden />
          )}

          <span className="text-sm font-medium text-foreground">{role.name}</span>
          {role.is_system && (
            <Badge variant="secondary" className="text-[10px]">
              {t('roleSystemBadge')}
            </Badge>
          )}
          {role.description && (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              — {role.description}
            </span>
          )}

          {canManage && !role.is_system && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
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
      {/* Bigin-style header row: blurb left, action right */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h3 className="text-lg font-semibold text-foreground">{t('rolesTitle')}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
            {t('rolesDesc')}
          </p>
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

      {/* Expand / collapse controls */}
      <div className="mt-4 flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="font-medium text-primary hover:underline"
        >
          {t('expandAll')}
        </button>
        <span className="text-border">·</span>
        <button
          type="button"
          onClick={() => setCollapsed(new Set(roles.map((r) => r.id)))}
          className="font-medium text-primary hover:underline"
        >
          {t('collapseAll')}
        </button>
      </div>

      {/* Role hierarchy tree */}
      <div className="mt-2">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : roots.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted-foreground">{t('noRoles')}</p>
        ) : (
          roots.map((role) => renderNode(role, 0))
        )}
      </div>

      {/* Create New Role — generic right-side sheet, same pattern as
          Create Deal / Create Contact / Invite User. */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(next) => {
          if (!next) resetSheet();
          setSheetOpen(next);
        }}
      >
        <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-xl">{t('createRoleTitle')}</SheetTitle>
            <SheetDescription className="sr-only">{t('rolesDesc')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-3">
              <Label htmlFor="role-name" className="justify-self-end text-muted-foreground">
                {t('roleNameLabel')}
              </Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="bg-muted border-border text-foreground"
              />
            </div>

            <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-3">
              <Label className="justify-self-end text-muted-foreground">
                {t('reportsToLabel')}
              </Label>
              <Select value={parentId} onValueChange={(v) => v && setParentId(v)}>
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue placeholder={t('selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-3">
              <Label
                htmlFor="role-peer-visibility"
                className="justify-self-end text-muted-foreground"
              >
                {t('peerVisibilityLabel')}
              </Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="role-peer-visibility"
                  checked={peerVisibility}
                  onCheckedChange={setPeerVisibility}
                />
                <span className="text-sm text-foreground">{t('peerVisibilityText')}</span>
              </div>
            </div>

            <div className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-3">
              <Label
                htmlFor="role-description"
                className="justify-self-end pt-2 text-muted-foreground"
              >
                {t('descriptionLabel')}
              </Label>
              <Textarea
                id="role-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descPlaceholder')}
                maxLength={500}
                rows={3}
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setSheetOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
                  <span className="font-semibold text-foreground">{chunks}</span>
                ),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>{t('cancel')}</AlertDialogCancel>
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
