'use client';

// ============================================================
// WorkspaceProfilesTab — Settings → Users and Controls → Profiles
//
// Bigin-style Profiles surface: heading + explainer, green
// "+ Create New Profile" action, and a sheet-table listing
// Profile Name | Profile Description | Users. System profiles
// (Administrator, Standard) are read-only; custom profiles get
// a full grouped permission matrix editor in a side sheet.
//
// Mutations require members:manage — the button and row actions
// are hidden without it, and the API + RLS re-check server-side.
// ============================================================

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';
import {
  Copy,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DataTable } from '@/components/shared/section-view';
import {
  RecordField,
  RecordLookup,
  RecordSection,
  RecordSheet,
} from '@/components/shared/record-sheet';
import { useCan } from '@/features/auth/hooks/use-can';
import {
  PERMISSION_GROUPS,
  type PermissionSlug,
} from '@/features/auth/lib/permissions';

interface WorkspaceProfile {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
}

interface EditorState {
  mode: 'create' | 'edit';
  profile: WorkspaceProfile | null;
  name: string;
  description: string;
  permissions: Set<PermissionSlug>;
}

async function fetchProfiles(url: string): Promise<WorkspaceProfile[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load profiles');
  const json = (await res.json()) as { data: WorkspaceProfile[] };
  return json.data ?? [];
}

export function WorkspaceProfilesTab({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const canManage = useCan('manage-members');

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WorkspaceProfile | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  // SWR owns fetch/loading/revalidate state — no manual load effect.
  const {
    data: profiles = [],
    isLoading: loading,
    mutate,
  } = useSWR('/api/account/profiles', fetchProfiles, {
    onError: () => toast.error('Failed to load profiles'),
  });
  const load = useCallback(() => mutate(), [mutate]);

  const openCreate = (cloneFrom?: WorkspaceProfile) => {
    setEditor({
      mode: 'create',
      profile: null,
      name: cloneFrom ? `Copy of ${cloneFrom.name}` : '',
      description: cloneFrom?.description ?? '',
      permissions: new Set((cloneFrom?.permissions ?? []) as PermissionSlug[]),
    });
  };

  const openEdit = (profile: WorkspaceProfile) => {
    setEditor({
      mode: 'edit',
      profile,
      name: profile.name,
      description: profile.description ?? '',
      permissions: new Set(profile.permissions as PermissionSlug[]),
    });
  };

  const togglePermission = (slug: PermissionSlug) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.permissions);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { ...prev, permissions: next };
    });
  };

  const toggleGroup = (slugs: PermissionSlug[], allOn: boolean) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.permissions);
      for (const slug of slugs) {
        if (allOn) next.delete(slug);
        else next.add(slug);
      }
      return { ...prev, permissions: next };
    });
  };

  const save = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (name === '') {
      toast.error('Profile name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        description: editor.description.trim(),
        permissions: [...editor.permissions],
      };
      const res =
        editor.mode === 'create'
          ? await fetch('/api/account/profiles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/account/profiles/${editor.profile!.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(json?.error ?? 'Failed to save profile');
      }
      toast.success(
        editor.mode === 'create' ? 'Profile created' : 'Profile updated'
      );
      setEditor(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save profile'
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/account/profiles/${confirmDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(json?.error ?? 'Failed to delete profile');
      }
      toast.success('Profile deleted');
      setConfirmDelete(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete profile'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold tracking-tight">
            Profiles
          </h2>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-sm leading-relaxed">
            Profiles help you define a set of permissions for each user as well
            as the actions they can perform. When you invite users, you assign a
            profile to each of them.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => openCreate()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full"
          >
            <Plus className="size-4" />
            Create New Profile
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-lg border py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : (
        <DataTable
          columns={[
            {
              id: 'name',
              header: 'Profile Name',
              className: 'w-[22%]',
              cell: (p: WorkspaceProfile) => (
                <span className="text-foreground flex items-center gap-2 font-semibold">
                  {p.name}
                  {p.is_system && (
                    <Lock
                      className="text-muted-foreground size-3.5"
                      aria-label="System profile"
                    />
                  )}
                </span>
              ),
            },
            {
              id: 'description',
              header: 'Profile Description',
              cell: (p: WorkspaceProfile) => (
                <span className="text-muted-foreground line-clamp-1">
                  {p.description ?? '—'}
                </span>
              ),
            },
            {
              id: 'users',
              header: 'Users',
              className: 'w-[10%]',
              cell: (p: WorkspaceProfile) => (
                <Badge variant="secondary" className="rounded-full">
                  {p.member_count}
                </Badge>
              ),
            },
            ...(canManage
              ? [
                  {
                    id: 'actions',
                    header: <span className="sr-only">Actions</span>,
                    className: 'w-12',
                    cell: (p: WorkspaceProfile) => (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Actions for ${p.name}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent
                          align="end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!p.is_system && (
                            <DropdownMenuItem onClick={() => openEdit(p)}>
                              <Pencil className="size-4" />
                              Edit profile
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openCreate(p)}>
                            <Copy className="size-4" />
                            Clone profile
                          </DropdownMenuItem>
                          {!p.is_system && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={p.member_count > 0}
                                onClick={() => setConfirmDelete(p)}
                              >
                                <Trash2 className="size-4" />
                                {p.member_count > 0
                                  ? 'Delete (has users)'
                                  : 'Delete profile'}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ),
                  },
                ]
              : []),
          ]}
          rows={profiles}
          rowKey={(p) => p.id}
          onRowClick={
            canManage
              ? (p) => (p.is_system ? openCreate(p) : openEdit(p))
              : undefined
          }
          empty="No profiles yet."
        />
      )}

      {/* ---- Create / Edit sheet — the generic RecordSheet design shared
              with Create Contact / Create Deal / Create Role / New User ---- */}
      <RecordSheet
        open={editor !== null}
        title={
          editor?.mode === 'create'
            ? 'Create New Profile'
            : `Edit ${editor?.profile?.name ?? ''}`
        }
        description="Choose what users assigned to this profile can see and do."
        saving={saving}
        isCreate={editor?.mode === 'create'}
        onOpenChange={(open) => !open && setEditor(null)}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {editor && (
          <>
            <RecordSection id="profile-details" title="Profile Information">
              <RecordField label="Profile Name" htmlFor="profile-name">
                <Input
                  id="profile-name"
                  autoFocus
                  value={editor.name}
                  maxLength={80}
                  onChange={(e) =>
                    setEditor((prev) =>
                      prev ? { ...prev, name: e.target.value } : prev
                    )
                  }
                  placeholder="e.g. Sales Agent"
                  className="h-11"
                />
              </RecordField>

              <RecordField label="Description" htmlFor="profile-description">
                <Textarea
                  id="profile-description"
                  value={editor.description}
                  maxLength={500}
                  rows={2}
                  onChange={(e) =>
                    setEditor((prev) =>
                      prev ? { ...prev, description: e.target.value } : prev
                    )
                  }
                  placeholder="What is this profile for?"
                />
              </RecordField>

              {editor.mode === 'create' && profiles.length > 0 && (
                <RecordField label="Start from" htmlFor="profile-start-from">
                  <RecordLookup
                    id="profile-start-from"
                    value={null}
                    options={profiles.map((p) => ({
                      id: p.id,
                      label: p.name,
                      hint: p.is_system ? 'System' : undefined,
                    }))}
                    placeholder="Copy permissions from an existing profile"
                    onSelect={(id) => {
                      const source = profiles.find((p) => p.id === id);
                      if (source) {
                        setEditor((prev) =>
                          prev
                            ? {
                                ...prev,
                                permissions: new Set(
                                  source.permissions as PermissionSlug[]
                                ),
                              }
                            : prev
                        );
                      }
                    }}
                  />
                </RecordField>
              )}
            </RecordSection>

            <RecordSection id="profile-permissions" title="Permissions">
              {PERMISSION_GROUPS.map((group) => {
                const slugs = group.permissions.map((p) => p.slug);
                const onCount = slugs.filter((s) =>
                  editor.permissions.has(s)
                ).length;
                const allOn = onCount === slugs.length;
                return (
                  <fieldset key={group.key} className="space-y-2.5">
                    <legend className="text-foreground flex w-full items-center justify-between text-sm font-semibold">
                      {group.label}
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => toggleGroup(slugs, allOn)}
                      >
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    </legend>
                    <div className="space-y-2 rounded-lg border p-3">
                      {group.permissions.map((perm) => (
                        <label
                          key={perm.slug}
                          className="flex cursor-pointer items-start gap-2.5"
                        >
                          <Checkbox
                            checked={editor.permissions.has(perm.slug)}
                            onCheckedChange={() => togglePermission(perm.slug)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="text-foreground block text-sm font-medium">
                              {perm.label}
                            </span>
                            <span className="text-muted-foreground block text-xs leading-relaxed">
                              {perm.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </RecordSection>
          </>
        )}
      </RecordSheet>

      {/* ---- Delete confirmation ---- */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete profile?</DialogTitle>
            <DialogDescription>
              {`"${confirmDelete?.name}" will be permanently deleted. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void remove()}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
