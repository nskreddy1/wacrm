'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/switch';
import type { ChannelConnection, ChannelKind } from '@/types';

type Connection = ChannelConnection & {
  credentialsConfigured: boolean;
  providerLabel: string;
};

const CHANNEL_LABEL: Record<ChannelKind, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
};

/**
 * Number/connection details sheet — same design language as the Edit
 * Field sheet. Shows the connection's facts as muted rows plus the
 * operational controls: test connection, enable/disable.
 */
export function ChannelConnectionSheet({
  connection,
  channel,
  open,
  onOpenChange,
  onChanged,
}: {
  connection: Connection | null;
  channel: ChannelKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');

  async function request(body: unknown, method: string) {
    const response = await fetch('/api/settings/channels', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error ?? 'Channel operation failed');
    await onChanged();
    return payload;
  }

  async function test() {
    if (!connection) return;
    setBusy('test');
    try {
      await request(
        {
          action: 'test',
          id: connection.id,
          recipient: channel === 'email' ? recipient || undefined : undefined,
        },
        'POST'
      );
      toast.success(
        recipient
          ? 'Connection verified and test message sent.'
          : 'Connection verified.'
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Connection test failed'
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggle(enabled: boolean) {
    if (!connection) return;
    setBusy('toggle');
    try {
      await request(
        {
          id: connection.id,
          isEnabled: enabled,
          isPrimary: enabled ? true : undefined,
        },
        'PATCH'
      );
      toast.success(enabled ? 'Connection enabled.' : 'Connection disabled.');
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not update connection'
      );
    } finally {
      setBusy(null);
    }
  }

  if (!connection) return null;
  const label = CHANNEL_LABEL[channel];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-border border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2.5 text-lg">
            {connection.display_name}
            <Badge variant="secondary" className="rounded-full font-normal">
              {label}
            </Badge>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Details for the {connection.display_name} connection
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              {channel === 'email' ? 'Sender' : 'Number'}
            </span>
            <span className="text-foreground text-sm font-medium">
              {connection.external_identity}
            </span>
          </div>
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              Provider
            </span>
            <span className="text-foreground text-sm font-medium">
              {connection.providerLabel}
            </span>
          </div>
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              Status
            </span>
            <Badge
              variant={
                connection.status === 'connected' ? 'default' : 'secondary'
              }
            >
              {connection.status}
            </Badge>
          </div>
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              Role
            </span>
            <span className="text-foreground text-sm font-medium">
              {connection.is_primary ? 'Primary connection' : 'Secondary'}
            </span>
          </div>
          {connection.managed_by === 'platform' ? (
            <div className="bg-primary-soft flex items-start gap-3 rounded-md px-4 py-3.5">
              <ShieldCheck
                className="text-primary mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-foreground text-sm font-medium">
                  Managed by our support team
                </span>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  This connection is configured and maintained for you. You can
                  enable, disable, and test it — contact support to change
                  credentials or the sender number.
                </p>
              </div>
            </div>
          ) : null}

          {connection.last_error ? (
            <Alert variant="destructive">
              <AlertTitle>Last test failed</AlertTitle>
              <AlertDescription>{connection.last_error}</AlertDescription>
            </Alert>
          ) : null}

          {channel === 'email' ? (
            <div className="flex flex-col gap-2 pt-1">
              <Label htmlFor="details-test-recipient">
                Optional test recipient
              </Label>
              <Input
                id="details-test-recipient"
                type="email"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
          ) : null}

          <div className="border-border flex items-center justify-between rounded-md border px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="details-enabled" className="text-sm font-medium">
                Enabled
              </Label>
              <p className="text-muted-foreground text-xs">
                Disabled connections never send or receive.
              </p>
            </div>
            <Switch
              id="details-enabled"
              checked={connection.is_enabled}
              onCheckedChange={toggle}
              disabled={busy !== null}
            />
          </div>
        </div>

        <SheetFooter className="border-border flex-row justify-end gap-2 border-t px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={test} disabled={busy !== null}>
            {busy === 'test' ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <CheckCircle2 data-icon="inline-start" />
            )}
            Test connection
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
