'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { ClientAgent } from '../lib/agent-meta';

// ------------------------------------------------------------------
// Specialist agent editor — create + edit form for custom specialist
// agents (2026 router → specialist pattern). A specialist is a
// persona + routing description; it runs on the default agent's
// provider connection, so no key or model setup is needed here.
// The router hands a conversation to the specialist whose routing
// description best matches what the customer is asking about.
// ------------------------------------------------------------------

interface SpecialistEditorProps {
  /** null → create mode; otherwise edit mode for this specialist. */
  specialist: ClientAgent | null;
  canManage: boolean;
  onSaved: () => Promise<unknown> | void;
  onDeleted?: () => Promise<unknown> | void;
  onCancel?: () => void;
}

export function SpecialistEditor({
  specialist,
  canManage,
  onSaved,
  onDeleted,
  onCancel,
}: SpecialistEditorProps) {
  const isCreate = specialist === null;

  const [name, setName] = useState(specialist?.displayName ?? '');
  const [route, setRoute] = useState(specialist?.routeDescription ?? '');
  const [prompt, setPrompt] = useState(specialist?.systemPrompt ?? '');
  const [enabled, setEnabled] = useState(specialist?.isEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const valid = name.trim().length > 0 && route.trim().length > 0;

  async function save() {
    if (!canManage || !valid) return;
    setSaving(true);
    try {
      const url = isCreate ? '/api/ai/agents' : `/api/ai/agents/${specialist.id}`;
      const body: Record<string, unknown> = {
        display_name: name.trim(),
        route_description: route.trim(),
        system_prompt: prompt.trim() || null,
        is_enabled: enabled,
      };
      if (isCreate) body.kind = 'custom';
      const res = await fetch(url, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? 'Failed to save specialist');
      toast.success(isCreate ? 'Specialist created' : 'Specialist updated');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canManage || isCreate) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/agents/${specialist.id}`, {
        method: 'DELETE',
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? 'Failed to delete specialist');
      toast.success('Specialist deleted');
      await onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h3 className="text-foreground text-sm font-semibold">
          {isCreate ? 'New specialist agent' : 'Edit specialist'}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          A specialist takes over conversations that match its expertise —
          your default agent routes each customer to the best match
          automatically. Specialists run on the default agent&apos;s provider
          connection and inherit its guardrails (reply cap, hours,
          escalation).
        </p>
      </div>

      <div>
        <label
          htmlFor="sp-name"
          className="text-foreground mb-1 block text-sm font-medium"
        >
          Name
        </label>
        <input
          id="sp-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canManage}
          placeholder="Billing Specialist"
          className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="sp-route"
          className="text-foreground mb-1 block text-sm font-medium"
        >
          When should this specialist take over?
        </label>
        <textarea
          id="sp-route"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          disabled={!canManage}
          rows={2}
          maxLength={500}
          placeholder="Billing questions, refunds, invoices, payment issues"
          className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
        />
        <p className="text-muted-foreground mt-1 text-xs">
          The router matches incoming conversations against this description.
          Be specific — list the topics, not a personality.
        </p>
      </div>

      <div>
        <label
          htmlFor="sp-prompt"
          className="text-foreground mb-1 block text-sm font-medium"
        >
          Instructions (optional)
        </label>
        <textarea
          id="sp-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!canManage}
          rows={5}
          placeholder="You handle billing for our business. You can explain invoices and our refund policy. Never promise a refund — offer to escalate instead."
          className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Replaces the default agent&apos;s persona when this specialist
          answers. Leave empty to keep the default persona.
        </p>
      </div>

      <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Enabled</p>
          <p className="text-muted-foreground text-xs">
            Only enabled specialists are considered by the router.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!canManage}
          onCheckedChange={setEnabled}
          aria-label="Toggle specialist"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={!canManage || saving || !valid}>
          {saving
            ? 'Saving…'
            : isCreate
              ? 'Create specialist'
              : 'Save changes'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        {!isCreate && canManage && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive ml-auto"
                  disabled={deleting}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {specialist.displayName}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Conversations will no longer be routed to this specialist.
                  Its usage history is kept. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={remove}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete specialist
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
