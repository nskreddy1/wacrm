'use client';

// ============================================================
// InviteUserSheet — Bigin-style "Invite User" panel.
//
// A right-side sheet with labeled rows (First Name, Last Name,
// Email, Role, Profile) and a Cancel / Invite User footer —
// mirroring Bigin's Users and Controls > New User flow.
//
//   • Role    = workspace reporting role (workspace_roles table,
//               e.g. "Level 1"), loaded live for this account.
//   • Profile = permission profile (account_role: admin / agent /
//               viewer) — what the person can DO.
//
// On success the sheet closes and an "Invite sent!" confirmation
// dialog appears (again mirroring Bigin), with the copyable
// invite link as a fallback for undelivered email.
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
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
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

type ProfileRole = 'admin' | 'agent' | 'viewer';

interface WorkspaceRoleOption {
  id: string;
  name: string;
}

interface InviteUserSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the
   *  pending-invitations list. */
  onCreated: () => void;
}

interface SentInvite {
  url: string;
  emailSent: boolean;
}

export function InviteUserSheet({
  open,
  onOpenChange,
  onCreated,
}: InviteUserSheetProps) {
  const t = useTranslations('Settings.invite');
  const tRoles = useTranslations('Settings.roles');
  const { profile } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [workspaceRoleId, setWorkspaceRoleId] = useState<string>('');
  const [profileRole, setProfileRole] = useState<ProfileRole>('agent');
  const [submitting, setSubmitting] = useState(false);

  const [wsRoles, setWsRoles] = useState<WorkspaceRoleOption[]>([]);
  const [sent, setSent] = useState<SentInvite | null>(null);

  // Load this workspace's reporting roles when the sheet opens.
  // RLS scopes the select to the member's account automatically.
  useEffect(() => {
    if (!open || !profile?.account_id) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('workspace_roles')
        .select('id, name')
        .eq('account_id', profile.account_id)
        .order('created_at', { ascending: true });
      if (!cancelled && data) {
        setWsRoles(data);
        // Default to the first role ("Level 1" seed) like Bigin.
        setWorkspaceRoleId((prev) => prev || data[0]?.id || '');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, profile?.account_id]);

  function reset() {
    setFirstName('');
    setLastName('');
    setEmail('');
    setWorkspaceRoleId('');
    setProfileRole('agent');
    setSubmitting(false);
  }

  async function handleInvite() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error(t('emailInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: profileRole,
          expiresInDays: 7,
          email: trimmedEmail,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          workspaceRoleId: workspaceRoleId || undefined,
          label:
            [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') ||
            trimmedEmail,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('inviteFailed'));
        return;
      }

      const data = (await res.json()) as {
        url: string;
        emailSent?: boolean;
      };

      onCreated();
      onOpenChange(false);
      reset();
      // Bigin-style confirmation dialog — after the sheet closes.
      setSent({ url: data.url, emailSent: Boolean(data.emailSent) });
    } catch (err) {
      console.error('[InviteUserSheet] create error:', err);
      toast.error(t('inviteFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('clipboardBlocked'));
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) reset();
          onOpenChange(next);
        }}
      >
        <SheetContent
          side="right"
          className="w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-xl">{t('sheetTitle')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('sheetDesc')}
            </SheetDescription>
          </SheetHeader>

          {/* Bigin-style label-left rows */}
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3">
              <Label htmlFor="invite-first-name" className="justify-self-end text-muted-foreground">
                {t('firstName')}
              </Label>
              <Input
                id="invite-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={80}
                className="bg-muted border-border text-foreground"
              />
            </div>

            <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3">
              <Label htmlFor="invite-last-name" className="justify-self-end text-muted-foreground">
                {t('lastName')}
              </Label>
              <Input
                id="invite-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={80}
                className="bg-muted border-border text-foreground"
              />
            </div>

            <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3">
              <Label htmlFor="invite-email" className="justify-self-end text-muted-foreground">
                {t('emailLabel')}
              </Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
                className="bg-muted border-border text-foreground"
              />
            </div>

            <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3">
              <Label className="justify-self-end text-muted-foreground">
                {t('roleLabel')}
              </Label>
              <Select
                value={workspaceRoleId}
                onValueChange={(v) => v && setWorkspaceRoleId(v)}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {wsRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3">
              <Label className="justify-self-end text-muted-foreground">
                {t('profileLabel')}
              </Label>
              <Select
                value={profileRole}
                onValueChange={(v) => v && setProfileRole(v as ProfileRole)}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                  <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                  <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleInvite}
              disabled={submitting}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('inviting')}
                </>
              ) : (
                t('inviteUser')
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Bigin-style "Invite sent!" confirmation */}
      <Dialog open={sent !== null} onOpenChange={(next) => !next && setSent(null)}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl text-popover-foreground">
              {t('inviteSentTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
              {sent?.emailSent ? t('inviteSentDesc') : t('inviteSentNoEmailDesc')}
            </DialogDescription>
          </DialogHeader>

          {/* Fallback link — shown only when the email could not be
              delivered so the admin can still share access. */}
          {sent && !sent.emailSent && (
            <div className="flex gap-2 py-1">
              <Input
                readOnly
                value={sent.url}
                className="bg-muted border-border text-foreground font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                onClick={copyLink}
                className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
              >
                <Copy className="size-4" />
                {t('copy')}
              </Button>
            </div>
          )}

          <DialogFooter className="bg-popover border-border">
            <Button
              onClick={() => setSent(null)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {t('okayGotIt')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
