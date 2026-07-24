'use client';

// ============================================================
// VerifiedDomainsCard — Settings → Users and Controls → Workspace
//
// Enterprise domain capture (Slack/Notion pattern): an admin adds
// their company email domain, proves ownership via a DNS TXT
// record, and from then on anyone signing up with a matching
// email is JIT-provisioned straight into this workspace with the
// domain's default profile/role (handled by handle_new_user).
//
// Security model:
//   - list/insert/delete go through RLS (admin+ only for writes;
//     public mailbox providers are rejected at the policy level)
//   - `verified` can ONLY be flipped by the server verify route
//     after a real DNS TXT lookup — clients cannot self-verify.
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  BadgeCheck,
  Copy,
  Globe,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';

interface AccountDomain {
  id: string;
  domain: string;
  verified: boolean;
  auto_join_enabled: boolean;
  verification_token: string;
}

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

export function VerifiedDomainsCard() {
  const t = useTranslations('Settings.members');
  const { account, canEditSettings } = useAuth();
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const {
    data: domains = [],
    mutate,
    isLoading,
  } = useSWR(
    account ? (['account-domains', account.id] as const) : null,
    async ([, accountId]) => {
      const supabase = createClient();
      const { data } = await supabase
        .from('account_domains')
        .select('id, domain, verified, auto_join_enabled, verification_token')
        .eq('account_id', accountId)
        .order('created_at');
      return (data ?? []) as AccountDomain[];
    }
  );

  if (!account) return null;

  const addDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const domain = draft.trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) {
      toast.error(t('domainInvalid'));
      return;
    }
    setAdding(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('account_domains')
        .insert({ account_id: account.id, domain });
      if (error) {
        // RLS check violation === public mailbox provider or non-admin.
        toast.error(
          error.code === '42501' || error.message.includes('policy')
            ? t('domainPublicProvider')
            : error.message
        );
        return;
      }
      setDraft('');
      void mutate();
    } finally {
      setAdding(false);
    }
  };

  const verifyDomain = async (d: AccountDomain) => {
    setBusyId(d.id);
    try {
      const res = await fetch(`/api/account/domains/${d.id}/verify`, {
        method: 'POST',
      });
      const body = (await res.json()) as {
        verified?: boolean;
        error?: string;
      };
      if (body.verified) {
        toast.success(t('domainVerifiedToast', { domain: d.domain }));
        void mutate();
      } else {
        toast.error(t('domainTxtMissing'));
      }
    } finally {
      setBusyId(null);
    }
  };

  const toggleAutoJoin = async (d: AccountDomain, next: boolean) => {
    // Optimistic — the switch flips instantly, rolls back on error.
    void mutate(
      (prev) =>
        prev?.map((x) =>
          x.id === d.id ? { ...x, auto_join_enabled: next } : x
        ),
      { revalidate: false }
    );
    const supabase = createClient();
    const { error } = await supabase
      .from('account_domains')
      .update({ auto_join_enabled: next })
      .eq('id', d.id);
    if (error) {
      toast.error(error.message);
      void mutate();
    }
  };

  const removeDomain = async (d: AccountDomain) => {
    setBusyId(d.id);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('account_domains')
        .delete()
        .eq('id', d.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      void mutate();
    } finally {
      setBusyId(null);
    }
  };

  const copyTxt = (d: AccountDomain) => {
    void navigator.clipboard.writeText(
      `wacrm-verify=${d.verification_token}`
    );
    toast.success(t('domainTxtCopied'));
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Globe className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-foreground text-sm font-semibold">
              {t('domainsTitle')}
            </h3>
            <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
              {t('domainsDesc')}
            </p>
          </div>
        </div>

        {canEditSettings && (
          <form onSubmit={addDomain} className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('domainPlaceholder')}
              className="h-9 max-w-xs"
              autoComplete="off"
            />
            <Button
              type="submit"
              size="sm"
              disabled={adding || draft.trim().length === 0}
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              {t('domainAdd')}
            </Button>
          </form>
        )}

        {isLoading ? (
          <p className="text-muted-foreground py-2 text-sm">…</p>
        ) : domains.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('domainsEmpty')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {domains.map((d) => (
              <li key={d.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-foreground font-mono text-sm font-medium">
                    {d.domain}
                  </span>
                  {d.verified ? (
                    <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <BadgeCheck className="size-3" aria-hidden />
                      {t('domainVerified')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground gap-1">
                      <ShieldAlert className="size-3" aria-hidden />
                      {t('domainPending')}
                    </Badge>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {d.verified && canEditSettings && (
                      <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        {t('domainAutoJoin')}
                        <Switch
                          checked={d.auto_join_enabled}
                          onCheckedChange={(next) =>
                            void toggleAutoJoin(d, next)
                          }
                          aria-label={t('domainAutoJoin')}
                        />
                      </label>
                    )}
                    {!d.verified && canEditSettings && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busyId === d.id}
                        onClick={() => void verifyDomain(d)}
                      >
                        {busyId === d.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        {t('domainVerifyBtn')}
                      </Button>
                    )}
                    {canEditSettings && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-7"
                        disabled={busyId === d.id}
                        onClick={() => void removeDomain(d)}
                        aria-label={t('domainRemove')}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </span>
                </div>

                {!d.verified && canEditSettings && (
                  <div className="bg-muted/60 text-muted-foreground flex flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 text-xs">
                    <span>{t('domainTxtHint')}</span>
                    <code className="bg-background text-foreground rounded px-1.5 py-0.5 font-mono text-[11px] break-all">
                      wacrm-verify={d.verification_token}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => copyTxt(d)}
                      aria-label={t('domainTxtCopy')}
                    >
                      <Copy className="size-3" aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
