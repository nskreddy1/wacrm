'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { BadgeCheck, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================
// Admin console · Plans — the platform operator's pricing desk.
// Everything about a tier is editable inline: name, description,
// prices, currency, feature bullets, badge, default flag,
// availability, ordering, and all seven quota limits.
// ============================================================

interface Plan {
  id: string;
  display_name: string;
  description: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  currency: string;
  features: string[];
  badge: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  max_contacts: number | null;
  max_active_flows: number | null;
  max_members: number | null;
  max_channels: number | null;
  monthly_messages: number | null;
  monthly_broadcast_recipients: number | null;
  monthly_ai_replies: number | null;
}

interface PlansResponse {
  plans: Plan[];
  accountCounts: Record<string, number>;
}

const LIMIT_FIELDS: Array<{ key: keyof Plan; label: string }> = [
  { key: 'max_contacts', label: 'Contacts' },
  { key: 'max_active_flows', label: 'Active flows' },
  { key: 'max_members', label: 'Team members' },
  { key: 'max_channels', label: 'Channels' },
  { key: 'monthly_messages', label: 'Messages / month' },
  { key: 'monthly_broadcast_recipients', label: 'Broadcast recipients / month' },
  { key: 'monthly_ai_replies', label: 'AI replies / month' },
];

async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load');
  return res.json();
}

/** Rupee display for paise-stored prices; NULL = contact us. */
function formatPrice(minor: number | null, currency: string) {
  if (minor === null) return 'Custom';
  if (minor === 0) return 'Free';
  const major = minor / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
}

export function AdminPlans() {
  const { data, isLoading, mutate } = useSWR<PlansResponse>(
    '/api/admin/plans',
    fetcher
  );

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-12 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading plans…
      </div>
    );
  }

  const plans = data?.plans ?? [];
  const counts = data?.accountCounts ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-base font-semibold">Plans</h2>
          <p className="text-muted-foreground text-sm">
            Rename tiers, set prices and quotas, curate feature lists, and
            control which plans new accounts can join.
          </p>
        </div>
        <CreatePlanDialog onCreated={() => mutate()} />
      </div>

      {/* Container-query columns: a plan card needs ~360px to hold its
          two-up fields and footer buttons. Splitting on the console's real
          width (not the viewport) keeps cards honest whether the app
          sidebar is collapsed or expanded. */}
      <div className="@3xl/console:grid-cols-2 @6xl/console:grid-cols-3 grid gap-4">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            accountCount={counts[plan.id] ?? 0}
            onChanged={() => mutate()}
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  accountCount,
  onChanged,
}: {
  plan: Plan;
  accountCount: number;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Plan>(plan);
  const [dirty, setDirty] = useState(false);

  function update<K extends keyof Plan>(key: K, value: Plan[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Update failed');
      toast.success(`${draft.display_name} saved`);
      setDirty(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await patch({
      display_name: draft.display_name,
      description: draft.description,
      price_monthly: draft.price_monthly,
      price_yearly: draft.price_yearly,
      currency: draft.currency,
      features: draft.features,
      badge: draft.badge?.trim() ? draft.badge : null,
      sort_order: draft.sort_order,
      max_contacts: draft.max_contacts,
      max_active_flows: draft.max_active_flows,
      max_members: draft.max_members,
      max_channels: draft.max_channels,
      monthly_messages: draft.monthly_messages,
      monthly_broadcast_recipients: draft.monthly_broadcast_recipients,
      monthly_ai_replies: draft.monthly_ai_replies,
    });
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete plan "${plan.display_name}"? This cannot be undone.`
      )
    )
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/plans/${plan.id}`, {
        method: 'DELETE',
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Delete failed');
      toast.success(`${plan.display_name} deleted`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label={`Plan ${draft.display_name}`}
      className={cn(
        '@container/plan bg-card flex flex-col gap-4 rounded-lg border p-4',
        !draft.is_active && 'opacity-70'
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={draft.display_name}
              onChange={(e) => update('display_name', e.target.value)}
              aria-label="Plan name"
              className="h-8 min-w-0 flex-1 text-sm font-semibold @xs/plan:max-w-40"
            />
            {draft.is_default && (
              <span className="text-primary flex shrink-0 items-center gap-1 text-xs font-medium">
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                Default
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            <code className="font-mono">{plan.id}</code> · {accountCount}{' '}
            account{accountCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor={`active-${plan.id}`}
            className="text-muted-foreground text-xs"
          >
            Active
          </Label>
          <Switch
            id={`active-${plan.id}`}
            checked={draft.is_active}
            disabled={saving}
            onCheckedChange={(checked) => {
              update('is_active', checked);
              void patch({ is_active: checked });
            }}
          />
        </div>
      </header>

      <div className="@xs/plan:grid-cols-2 grid gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Monthly price (paise)</Label>
          <Input
            type="number"
            min={0}
            value={draft.price_monthly ?? ''}
            placeholder="Custom"
            aria-label="Monthly price in minor units"
            onChange={(e) =>
              update(
                'price_monthly',
                e.target.value === '' ? null : Number(e.target.value)
              )
            }
          />
          <p className="text-muted-foreground text-[11px]">
            Shows as {formatPrice(draft.price_monthly, draft.currency)}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Yearly price (paise)</Label>
          <Input
            type="number"
            min={0}
            value={draft.price_yearly ?? ''}
            placeholder="Custom"
            aria-label="Yearly price in minor units"
            onChange={(e) =>
              update(
                'price_yearly',
                e.target.value === '' ? null : Number(e.target.value)
              )
            }
          />
          <p className="text-muted-foreground text-[11px]">
            Shows as {formatPrice(draft.price_yearly, draft.currency)}
          </p>
        </div>
      </div>

      <div className="@xs/plan:grid-cols-2 grid gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Badge</Label>
          <Input
            value={draft.badge ?? ''}
            placeholder="e.g. Most popular"
            aria-label="Marketing badge"
            onChange={(e) => update('badge', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Sort order</Label>
          <Input
            type="number"
            min={0}
            value={draft.sort_order}
            aria-label="Sort order"
            onChange={(e) => update('sort_order', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Description</Label>
        <Input
          value={draft.description ?? ''}
          placeholder="One-line pitch"
          aria-label="Plan description"
          onChange={(e) => update('description', e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Features (one per line)</Label>
        <Textarea
          value={draft.features.join('\n')}
          rows={4}
          aria-label="Feature list, one feature per line"
          onChange={(e) =>
            update(
              'features',
              e.target.value.split('\n').filter((line) => line.trim() !== '')
            )
          }
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium">
          Limits (blank = unlimited)
        </legend>
        <div className="@xs/plan:grid-cols-2 grid gap-2">
          {LIMIT_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <Label className="text-muted-foreground text-[11px]">
                {label}
              </Label>
              <Input
                type="number"
                min={0}
                value={(draft[key] as number | null) ?? ''}
                placeholder="∞"
                aria-label={label}
                onChange={(e) =>
                  update(
                    key,
                    (e.target.value === ''
                      ? null
                      : Number(e.target.value)) as Plan[typeof key]
                  )
                }
              />
            </div>
          ))}
        </div>
      </fieldset>

      {/* Wraps instead of overflowing: on a narrow card the actions stack
          onto their own row rather than pushing Save past the border. */}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex min-w-0 items-center gap-2">
          {!draft.is_default && (
            <Button
              variant="outline"
              size="sm"
              disabled={saving || !draft.is_active}
              onClick={() => void patch({ is_default: true })}
            >
              Make default
            </Button>
          )}
          {!draft.is_default && accountCount === 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void handleDelete()}
              aria-label={`Delete plan ${draft.display_name}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving && (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          )}
          Save changes
        </Button>
      </footer>
    </section>
  );
}

function CreatePlanDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, display_name: name }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Create failed');
      toast.success(`${name} created — configure its limits below`);
      setOpen(false);
      setId('');
      setName('');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" aria-hidden="true" />
        New plan
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create plan</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-plan-id" className="text-xs">
              Slug (permanent)
            </Label>
            <Input
              id="new-plan-id"
              value={id}
              placeholder="e.g. starter"
              onChange={(e) =>
                setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-plan-name" className="text-xs">
              Display name
            </Label>
            <Input
              id="new-plan-name"
              value={name}
              placeholder="e.g. Starter"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            disabled={creating || id.length < 3 || !name.trim()}
            onClick={() => void handleCreate()}
          >
            {creating && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
