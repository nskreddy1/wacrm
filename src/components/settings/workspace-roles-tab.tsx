'use client';

// ============================================================================
// Workspace roles — the "Roles" tab under Settings → Users and Controls.
// ----------------------------------------------------------------------------
// Roles are DB rows (workspace_roles, RLS-protected): admins create/delete,
// everyone can read. Assign a role to many users; edit the role once and
// everyone holding it updates. System roles are seeded and undeletable —
// the delete policy in the migration enforces that server-side; the UI
// merely hides the button.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { DataTable } from '@/components/shared/section-view';
import { RequireRole } from '@/components/auth/require-role';

interface WorkspaceRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  is_system: boolean;
  /** Embedded count of profiles holding this role. */
  holders: number;
}

// Atomic "resource:action" permission catalog. The backend/RLS is the
// enforcement point; this list only drives the editor UI.
const PERMISSION_GROUPS: { resource: string; label: string; actions: string[] }[] = [
  { resource: 'contacts', label: 'Contacts', actions: ['read', 'edit', 'delete'] },
  { resource: 'deals', label: 'Deals', actions: ['read', 'edit', 'delete'] },
  { resource: 'activities', label: 'Activities', actions: ['read', 'edit'] },
  { resource: 'broadcasts', label: 'Broadcasts', actions: ['read', 'edit'] },
  { resource: 'settings', label: 'Settings', actions: ['manage'] },
  { resource: 'users', label: 'Users', actions: ['manage'] },
];

export function WorkspaceRolesTab() {
  const t = useTranslations('Settings.members');
  const { accountId, user } = useAuth();

  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<WorkspaceRole | null>(null);
  const [busy, setBusy] = useState(false);

  // Create-sheet draft
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  const loadRoles = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from('workspace_roles')
      .select('id, name, description, permissions, is_system, profiles(count)')
      .eq('account_id', accountId)
      .order('is_system', { ascending: false })
      .order('name');
    if (error) {
      toast.error(error.message);
      return;
    }
    setRoles(
      (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        permissions: row.permissions ?? [],
        is_system: row.is_system,
        holders: (row.profiles as unknown as { count: number }[])?.[0]?.count ?? 0,
      })),
    );
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadRoles();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRoles]);

  function togglePermission(key: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleCreate() {
    if (!accountId || !name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from('workspace_roles').insert({
      account_id: accountId,
      name: name.trim(),
      description: description.trim(),
      permissions: [...permissions],
      created_by: user?.id ?? null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('roleCreatedToast', { name: name.trim() }));
    setCreateOpen(false);
    setName('');
    setDescription('');
    setPermissions(new Set());
    void loadRoles();
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from('workspace_roles').delete().eq('id', deleting.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('roleDeletedToast', { name: deleting.name }));
    setDeleting(null);
    void loadRoles();
  }

  const permissionSummary = useMemo(
    () => (perms: string[]) =>
      perms.some((p) => p.endsWith(':*'))
        ? 'Full access'
        : `${perms.length} ${perms.length === 1 ? 'permission' : 'permissions'}`,
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('rolesTitle')}</h3>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground text-pretty">
            {t('rolesDescription')}
          </p>
        </div>
        <RequireRole min="admin">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('newRole')}
          </Button>
        </RequireRole>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DataTable<WorkspaceRole>
          rows={roles}
          rowKey={(r) => r.id}
          empty={<span>{t('noRoles')}</span>}
          columns={[
            {
              id: 'name',
              header: t('roleName'),
              className: 'w-[28%]',
              cell: (r) => (
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                  {r.name}
                  {r.is_system && (
                    <Badge className="bg-muted text-muted-foreground border-border text-[10px] uppercase tracking-wide">
                      <Lock className="size-2.5" />
                      {t('roleSystem')}
                    </Badge>
                  )}
                </span>
              ),
            },
            {
              id: 'description',
              header: t('roleDescriptionLabel'),
              className: 'w-[36%]',
              cell: (r) => (
                <span className="text-muted-foreground">{r.description || '—'}</span>
              ),
            },
            {
              id: 'permissions',
              header: t('rolePermissions'),
              cell: (r) => (
                <span className="text-muted-foreground">{permissionSummary(r.permissions)}</span>
              ),
            },
            {
              id: 'holders',
              header: t('tabUsers'),
              cell: (r) => (
                <span className="text-muted-foreground">
                  {t('roleMembers', { count: r.holders })}
                </span>
              ),
            },
            {
              id: 'actions',
              header: <span className="sr-only">{t('colActions')}</span>,
              className: 'w-12 text-right',
              cell: (r) =>
                r.is_system ? null : (
                  <RequireRole min="admin">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleting(r)}
                      aria-label={t('roleDeleteBtn')}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </RequireRole>
                ),
            },
          ]}
        />
      )}

      {/* Create role — right-side sheet, mirroring the Add User pattern. */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('newRole')}</SheetTitle>
            <SheetDescription>{t('rolesDescription')}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-name">{t('roleName')}</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('roleNamePlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-desc">{t('roleDescriptionLabel')}</Label>
              <Textarea
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('roleDescPlaceholder')}
                rows={2}
              />
            </div>
            <div className="flex flex-col gap-3">
              <Label>{t('rolePermissions')}</Label>
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.resource} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-foreground">{group.label}</p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                    {group.actions.map((action) => {
                      const key = `${group.resource}:${action}`;
                      return (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
                        >
                          <Checkbox
                            checked={permissions.has(key)}
                            onCheckedChange={() => togglePermission(key)}
                          />
                          <span className="capitalize">{action}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('roleCreating')}
                </>
              ) : (
                t('roleCreate')
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('roleDeleteTitle')}</DialogTitle>
            <DialogDescription>
              {t.rich('roleDeleteDesc', {
                name: deleting?.name ?? '',
                bold: (chunks) => <strong>{chunks}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('roleDeleting')}
                </>
              ) : (
                t('roleDeleteBtn')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
