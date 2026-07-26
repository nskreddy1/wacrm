'use client';

/**
 * Per-tenant plan + limit override editor for the super-admin console.
 * Rendered inside the workspace detail sheet.
 *
 * Override model (mirrors src/lib/quotas):
 *   unlimited_all         -> account bypasses every limit
 *   column = -1           -> that one feature is unlimited
 *   column = null         -> no override (plan value applies)
 *   column = N >= 0       -> hard per-account cap
 */

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const jsonFetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Request failed');
    return r.json();
  });

const LIMIT_ROWS = [
  { key: 'max_contacts', label: 'Contacts' },
  { key: 'max_active_flows', label: 'Active flows' },
  { key: 'max_members', label: 'Member seats' },
  { key: 'max_channels', label: 'Channels' },
  { key: 'monthly_messages', label: 'Messages / month' },
  { key: 'monthly_broadcast_recipients', label: 'Broadcast recipients / month' },
  { key: 'monthly_ai_replies', label: 'AI replies / month' },
] as const;

type LimitKey = (typeof LIMIT_ROWS)[number]['key'];

interface LimitsPayload {
  account: { id: string; name: string; plan_id: string };
  override:
    | ({ unlimited_all: boolean; reason: string | null } & Record<
        LimitKey,
        number | null
      >)
    | null;
  plans: Array<{ id: string; display_name: string; is_active: boolean }>;
  usage: Array<{ metric: string; used: number }>;
}

export function WorkspaceLimitsPanel({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, mutate } = useSWR<LimitsPayload>(
    `/api/admin/workspaces/${workspaceId}/limits`,
    jsonFetcher
  );

  const [planId, setPlanId] = useState('');
  const [unlimitedAll, setUnlimitedAll] = useState(false);
  const [values, setValues] = useState<Record<LimitKey, number | null>>(
    {} as Record<LimitKey, number | null>
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Hydrate the form whenever fresh server state arrives.
  useEffect(() => {
    if (!data) return;
    setPlanId(data.account.plan_id);
    setUnlimitedAll(data.override?.unlimited_all ?? false);
    setReason(data.override?.reason ?? '');
    const next = {} as Record<LimitKey, number | null>;
    for (const row of LIMIT_ROWS) {
      next[row.key] = data.override?.[row.key] ?? null;
    }
    setValues(next);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/limits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          unlimited_all: unlimitedAll,
          reason: reason.trim() || null,
          ...values,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Save failed');
      }
      toast.success('Limits updated');
      mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="ws-plan" className="text-sm">
          Plan
        </Label>
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger id="ws-plan" className="w-44">
            <SelectValue placeholder="Select plan" />
          </SelectTrigger>
          <SelectContent>
            {data.plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.display_name}
                {p.is_active ? '' : ' (retired)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
        <span className="grid leading-tight">
          <span className="text-sm font-medium">Unlimited everything</span>
          <span className="text-muted-foreground text-xs">
            Bypasses every plan limit for this account (VIP / internal).
          </span>
        </span>
        <Switch
          checked={unlimitedAll}
          onCheckedChange={setUnlimitedAll}
          aria-label="Unlimited everything"
        />
      </div>

      {!unlimitedAll && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Per-feature overrides. Blank = plan default. Toggle a feature to
            unlimited or type a custom cap.
          </p>
          {LIMIT_ROWS.map((row) => {
            const value = values[row.key];
            const isUnlimited = value === -1;
            return (
              <div
                key={row.key}
                className="flex items-center justify-between gap-3"
              >
                <Label
                  htmlFor={`ov-${row.key}`}
                  className="text-sm font-normal"
                >
                  {row.label}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`ov-${row.key}`}
                    type="number"
                    min={0}
                    className="h-8 w-28 text-right"
                    placeholder="plan"
                    disabled={isUnlimited}
                    value={isUnlimited || value === null ? '' : value}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [row.key]:
                          e.target.value === ''
                            ? null
                            : Math.max(0, Number(e.target.value)),
                      }))
                    }
                  />
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id={`unl-${row.key}`}
                      checked={isUnlimited}
                      onCheckedChange={(checked) =>
                        setValues((v) => ({
                          ...v,
                          [row.key]: checked ? -1 : null,
                        }))
                      }
                      aria-label={`Unlimited ${row.label}`}
                    />
                    <Label
                      htmlFor={`unl-${row.key}`}
                      className="text-muted-foreground text-xs font-normal"
                    >
                      Unlimited
                    </Label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ov-reason" className="text-sm">
          Reason (audit note)
        </Label>
        <Input
          id="ov-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Enterprise pilot until March"
        />
      </div>

      <Button onClick={save} disabled={saving} className="self-end">
        {saving ? 'Saving…' : 'Save limits'}
      </Button>
    </div>
  );
}
