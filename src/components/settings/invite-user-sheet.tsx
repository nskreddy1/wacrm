'use client';

// ============================================================
// InviteUserSheet — Bigin-style "New User" panel.
//
// Composes the generic RecordSheet / RecordField / RecordLookup
// primitives (the same shared design as Create Contact, Create
// Deal, and Create Role) so every "create record" surface in the
// app looks identical.
//
//   • Role    = workspace reporting role (workspace_roles table,
//               e.g. "Level 1"), loaded live for this account.
//   • Profile = workspace profile (permission set: Administrator,
//               Standard, or custom) — what the person can DO.
//
// On success the sheet closes and an "Invite sent!" confirmation
// dialog appears (mirroring Bigin), with the copyable invite
// link as a fallback for undelivered email.
// ============================================================

import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Copy, Share2, ShieldCheck } from 'lucide-react';
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
import {
  RecordField,
  RecordLookup,
  RecordSheet,
} from '@/components/shared/record-sheet';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

interface WorkspaceRoleOption {
  id: string;
  name: string;
}

interface WorkspaceProfileOption {
  id: string;
  name: string;
  is_system: boolean;
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
  const { profile } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [workspaceRoleId, setWorkspaceRoleId] = useState<string>('');
  const [workspaceProfileId, setWorkspaceProfileId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [wsRoles, setWsRoles] = useState<WorkspaceRoleOption[]>([]);
  const [wsProfiles, setWsProfiles] = useState<WorkspaceProfileOption[]>([]);
  const [sent, setSent] = useState<SentInvite | null>(null);

  // Load this workspace's reporting roles + permission profiles when
  // the sheet opens. RLS scopes both to the member's account.
  useEffect(() => {
    if (!open || !profile?.account_id) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [{ data: roles }, profilesRes] = await Promise.all([
        supabase
          .from('workspace_roles')
          .select('id, name')
          .eq('account_id', profile.account_id)
          .order('created_at', { ascending: true }),
        fetch('/api/account/profiles').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (cancelled) return;
      if (roles) {
        setWsRoles(roles);
        // Default to the first role ("Level 1" seed) like Bigin.
        setWorkspaceRoleId((prev) => prev || roles[0]?.id || '');
      }
      const profiles = (profilesRes?.data ?? []) as WorkspaceProfileOption[];
      if (profiles.length > 0) {
        setWsProfiles(profiles);
        // Default to the "Standard" system profile like Bigin.
        const standard = profiles.find((p) => p.is_system && p.name === 'Standard');
        setWorkspaceProfileId((prev) => prev || standard?.id || profiles[0]?.id || '');
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
    setEmailError('');
    setWorkspaceRoleId('');
    setWorkspaceProfileId('');
    setSubmitting(false);
  }

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError(t('emailInvalid'));
      return;
    }
    setEmailError('');
    setSubmitting(true);
    try {
      // Legacy role enum kept for compatibility: Administrator system
      // profile maps to admin, everything else invites as agent. The
      // real capabilities come from workspaceProfileId.
      const selectedProfile = wsProfiles.find((p) => p.id === workspaceProfileId);
      const legacyRole =
        selectedProfile?.is_system && selectedProfile.name === 'Administrator'
          ? 'admin'
          : 'agent';

      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: legacyRole,
          expiresInDays: 7,
          email: trimmedEmail,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          workspaceRoleId: workspaceRoleId || undefined,
          workspaceProfileId: workspaceProfileId || undefined,
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
      <RecordSheet
        open={open}
        title={t('sheetTitle')}
        description={t('sheetDesc')}
        saving={submitting}
        isCreate
        onOpenChange={(next) => {
          if (!next) reset();
          onOpenChange(next);
        }}
        onSubmit={handleInvite}
      >
        <RecordField label={t('firstName')} htmlFor="invite-first-name">
          <Input
            id="invite-first-name"
            autoFocus
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={80}
            className="h-11"
          />
        </RecordField>

        <RecordField label={t('lastName')} htmlFor="invite-last-name">
          <Input
            id="invite-last-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={80}
            className="h-11"
          />
        </RecordField>

        <RecordField label={t('emailLabel')} htmlFor="invite-email" error={emailError}>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError('');
            }}
            maxLength={320}
            className="h-11"
          />
        </RecordField>

        <RecordField label={t('roleLabel')} htmlFor="invite-role">
          <RecordLookup
            id="invite-role"
            value={workspaceRoleId || null}
            options={wsRoles.map((r) => ({ id: r.id, label: r.name }))}
            placeholder={t('roleLabel')}
            icon={<Share2 className="size-4 shrink-0 rotate-90 text-muted-foreground" aria-hidden="true" />}
            onSelect={(id) => setWorkspaceRoleId(id ?? '')}
          />
        </RecordField>

        <RecordField label={t('profileLabel')} htmlFor="invite-profile">
          <RecordLookup
            id="invite-profile"
            value={workspaceProfileId || null}
            options={wsProfiles.map((p) => ({
              id: p.id,
              label: p.name,
              hint: p.is_system ? t('systemProfileHint') : undefined,
            }))}
            placeholder={t('profileLabel')}
            icon={<ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            onSelect={(id) => setWorkspaceProfileId(id ?? '')}
          />
        </RecordField>
      </RecordSheet>

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
              <Button type="button" onClick={copyLink} className="shrink-0">
                <Copy className="size-4" />
                {t('copy')}
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setSent(null)}>{t('okayGotIt')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
