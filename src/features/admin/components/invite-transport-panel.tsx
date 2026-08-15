'use client';

// ============================================================
// InviteTransportPanel — platform admin → Invite delivery sender.
//
// The ONLY place in the product where invitation mail credentials
// can be configured. Deliberately not a workspace setting: invites
// go to people who have no account yet, so letting each tenant pick
// the sending server would let any workspace send mail in the
// platform's name, invisibly to the operator.
//
// Reads/writes /api/admin/invite-transport, which is gated by
// `requireSuperAdmin()`. Secrets are never returned by the API — the
// GET response carries only a redacted summary, so the password /
// key inputs always start empty and an empty submit means "keep the
// stored secret".
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, SendHorizonal, ShieldCheck } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

type Provider = 'smtp' | 'resend' | 'mailtrap';

interface TransportSummary {
  configured: boolean;
  provider: Provider | null;
  fromEmail: string | null;
  fromName: string | null;
  host: string | null;
  port: number | null;
  secure: boolean;
  /** True when a secret is stored, so the UI can say so without reading it. */
  hasSecret: boolean;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  smtp: 'SMTP server',
  resend: 'Resend',
  mailtrap: 'Mailtrap',
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load transport settings');
  return res.json() as Promise<TransportSummary>;
};

/**
 * Fetches the redacted summary, then mounts the form.
 *
 * The form is a separate keyed component so its fields can be seeded
 * with `useState` initialisers instead of an effect that calls
 * setState. Syncing server data into state via useEffect would cause
 * cascading renders (and trips the React Compiler lint); remounting on
 * a data-identity key expresses "these are new initial values" directly.
 */
export function InviteTransportPanel() {
  const { data, isLoading, mutate } = useSWR<TransportSummary>(
    '/api/admin/invite-transport',
    fetcher
  );

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const summary: TransportSummary =
    data ??
    ({
      configured: false,
      provider: null,
      fromEmail: null,
      fromName: null,
      host: null,
      port: null,
      secure: false,
      hasSecret: false,
    } satisfies TransportSummary);

  return (
    <TransportForm
      key={`${summary.provider ?? 'none'}:${summary.fromEmail ?? ''}:${summary.host ?? ''}`}
      summary={summary}
      onSaved={() => void mutate()}
    />
  );
}

function TransportForm({
  summary: data,
  onSaved,
}: {
  summary: TransportSummary;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<Provider>(data.provider ?? 'smtp');
  const [fromEmail, setFromEmail] = useState(data.fromEmail ?? '');
  const [fromName, setFromName] = useState(data.fromName ?? '');
  const [host, setHost] = useState(data.host ?? '');
  const [port, setPort] = useState(data.port ? String(data.port) : '587');
  const [secure, setSecure] = useState(data.secure);
  const [username, setUsername] = useState('');
  // Secret inputs are intentionally not seeded from server data: the
  // API never sends the stored value back, so we start blank and only
  // transmit what the operator actually types.
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');

  const isSmtp = provider === 'smtp';
  const secretLabel = isSmtp ? 'Password' : 'API key';
  // An existing secret may be kept by leaving the field blank; a brand
  // new transport has nothing stored, so the secret is required.
  const secretRequired = !data.hasSecret || provider !== data.provider;

  async function save() {
    if (!fromEmail.trim()) {
      toast.error('A "from" address is required');
      return;
    }
    if (secretRequired && !secret.trim()) {
      toast.error(`${secretLabel} is required`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/invite-transport', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          fromEmail: fromEmail.trim(),
          fromName: fromName.trim() || null,
          ...(isSmtp
            ? { host: host.trim(), port: Number(port), secure, username }
            : {}),
          // Omitted when blank => server keeps the stored secret.
          ...(secret.trim() ? { secret: secret.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? 'Could not save transport');
        return;
      }
      setSecret('');
      onSaved();
      toast.success('Invite sender saved');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      toast.error('Enter an address to send the test to');
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/admin/invite-transport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const body = await res.json();
      if (!res.ok || body.sent === false) {
        toast.error(body.error ?? 'Test send failed');
        return;
      }
      toast.success(`Test email sent to ${testTo.trim()}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <div className="grid leading-tight">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          Invite sender
        </span>
        <span className="text-muted-foreground text-xs">
          Platform-only. Workspace admins cannot change this, so invitations
          always come from your verified sender.
        </span>
      </div>

      {data.configured ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <CheckCircle2
            className="text-primary size-3.5 shrink-0"
            aria-hidden="true"
          />
          Currently sending via {PROVIDER_LABELS[data.provider ?? 'smtp']}
          {data.fromEmail ? ` as ${data.fromEmail}` : null}
        </p>
      ) : null}

      <div className="@md/card:grid-cols-2 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="transport-provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={(v) => setProvider(v as Provider)}
          >
            <SelectTrigger id="transport-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="transport-from-email">From address</Label>
          <Input
            id="transport-from-email"
            type="email"
            inputMode="email"
            placeholder="invites@yourcompany.com"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="transport-from-name">
            From name{' '}
            <span className="text-muted-foreground font-normal">optional</span>
          </Label>
          <Input
            id="transport-from-name"
            placeholder="Your company"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="transport-secret">
            {secretLabel}{' '}
            {!secretRequired ? (
              <span className="text-muted-foreground font-normal">
                leave blank to keep
              </span>
            ) : null}
          </Label>
          <Input
            id="transport-secret"
            type="password"
            autoComplete="new-password"
            placeholder={secretRequired ? '' : '••••••••'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>

        {isSmtp ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="transport-host">SMTP host</Label>
              <Input
                id="transport-host"
                placeholder="smtp.yourprovider.com"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="transport-port">Port</Label>
              <Input
                id="transport-port"
                type="number"
                inputMode="numeric"
                placeholder="587"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="transport-username">Username</Label>
              <Input
                id="transport-username"
                autoComplete="off"
                placeholder="apikey or account name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label
                htmlFor="transport-secure"
                className="grid cursor-pointer gap-0.5 leading-tight"
              >
                <span>Implicit TLS</span>
                <span className="text-muted-foreground text-xs font-normal">
                  On for port 465, off for 587 (STARTTLS)
                </span>
              </Label>
              <Switch
                id="transport-secure"
                checked={secure}
                onCheckedChange={setSecure}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Save sender
        </Button>
      </div>

      {/* Test send lives behind the saved transport on purpose: it
          proves the stored credentials work, rather than validating a
          draft that was never persisted. */}
      {data.configured ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <Label htmlFor="transport-test-to">Send a test email</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="transport-test-to"
              type="email"
              inputMode="email"
              placeholder="you@yourcompany.com"
              className="max-w-xs"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() => void sendTest()}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <SendHorizonal className="size-4" aria-hidden="true" />
              )}
              Send test
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
