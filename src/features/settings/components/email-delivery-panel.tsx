'use client';

// ============================================================
// Email delivery settings — provider-agnostic (SMTP / Resend /
// MSG91). The workspace's own provider is used for invitation
// emails and future notification email. Credentials are written
// once (encrypted server-side) and never displayed again.
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { CheckCircle2, Loader2, Mail, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Provider = 'smtp' | 'resend' | 'msg91';

interface ClientSettings {
  provider: Provider;
  fromEmail: string;
  fromName: string | null;
  credentialsSaved: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json() as Promise<{ settings: ClientSettings | null }>;
};

const PROVIDER_LABELS: Record<Provider, string> = {
  smtp: 'SMTP (Gmail, Zoho, Outlook, cPanel…)',
  resend: 'Resend',
  msg91: 'MSG91 Email',
};

export function EmailDeliveryPanel() {
  const { data, isLoading, mutate } = useSWR(
    '/api/account/email-settings',
    fetcher
  );
  const saved = data?.settings ?? null;

  const [provider, setProvider] = useState<Provider>('smtp');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  // SMTP
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Resend / MSG91
  const [apiKey, setApiKey] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [domain, setDomain] = useState('');
  // Test + save state
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);

  const showForm = editing || !saved;

  function credentialsBody(): Record<string, unknown> {
    if (provider === 'smtp') {
      return { host, port: Number(port), secure, username, password };
    }
    if (provider === 'resend') return { apiKey };
    return { authKey, domain };
  }

  async function save(withTest: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          fromEmail,
          fromName,
          credentials: credentialsBody(),
          ...(withTest && testTo ? { testTo } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setMessage({
          kind: 'error',
          text: body?.error ?? 'Failed to save settings',
        });
        return;
      }
      setMessage({
        kind: 'ok',
        text: withTest
          ? 'Test email sent and settings saved.'
          : 'Settings saved.',
      });
      setEditing(false);
      setPassword('');
      setApiKey('');
      setAuthKey('');
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/email-settings', {
        method: 'DELETE',
      });
      if (res.ok) {
        setMessage({ kind: 'ok', text: 'Email settings removed.' });
        await mutate();
      } else {
        setMessage({ kind: 'error', text: 'Failed to remove settings.' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="email-delivery-heading"
      className="border-border bg-card rounded-xl border p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <Mail className="text-muted-foreground size-4" aria-hidden="true" />
        <h2
          id="email-delivery-heading"
          className="text-foreground text-sm font-semibold"
        >
          Email delivery
        </h2>
      </div>
      <p className="text-muted-foreground mb-5 text-xs leading-relaxed">
        Connect your own email provider so team invitations and
        notifications are sent from your domain. Supports any SMTP
        server, Resend, or MSG91. Credentials are stored encrypted and
        never shown again.
      </p>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-8"
          role="status"
          aria-label="Loading email settings"
        >
          <Loader2
            className="text-muted-foreground size-5 animate-spin"
            aria-hidden="true"
          />
        </div>
      ) : saved && !showForm ? (
        <div className="flex flex-col gap-4">
          <div className="border-border flex items-center gap-3 rounded-md border px-4 py-3">
            <CheckCircle2
              className="size-5 shrink-0 text-emerald-500"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-medium">
                {PROVIDER_LABELS[saved.provider]}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                Sending as {saved.fromName ? `${saved.fromName} ` : ''}
                &lt;{saved.fromEmail}&gt;
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(true);
                setProvider(saved.provider);
                setFromEmail(saved.fromEmail);
                setFromName(saved.fromName ?? '');
              }}
            >
              Update settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={remove}
              disabled={busy}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save(Boolean(testTo));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-provider">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as Provider)}
              >
                <SelectTrigger id="email-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from-email">From address</Label>
              <Input
                id="from-email"
                type="email"
                required
                placeholder="team@yourcompany.com"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from-name">From name (optional)</Label>
            <Input
              id="from-name"
              placeholder="Acme Support"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
          </div>

          {provider === 'smtp' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="smtp-host">SMTP host</Label>
                <Input
                  id="smtp-host"
                  required
                  placeholder="smtp.zoho.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  required
                  inputMode="numeric"
                  placeholder="587"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="smtp-user">Username</Label>
                <Input
                  id="smtp-user"
                  required
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="smtp-pass">Password</Label>
                <Input
                  id="smtp-pass"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch
                  id="smtp-secure"
                  checked={secure}
                  onCheckedChange={setSecure}
                />
                <Label htmlFor="smtp-secure" className="cursor-pointer">
                  Use TLS (port 465)
                </Label>
              </div>
            </div>
          ) : provider === 'resend' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resend-key">Resend API key</Label>
              <Input
                id="resend-key"
                type="password"
                required
                autoComplete="off"
                placeholder="re_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="msg91-key">MSG91 auth key</Label>
                <Input
                  id="msg91-key"
                  type="password"
                  required
                  autoComplete="off"
                  value={authKey}
                  onChange={(e) => setAuthKey(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="msg91-domain">Verified domain</Label>
                <Input
                  id="msg91-domain"
                  required
                  placeholder="mail.yourcompany.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="border-border flex flex-col gap-3 rounded-md border border-dashed p-3">
            <Label htmlFor="test-to" className="text-xs">
              Send a test email before saving (recommended)
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="test-to"
                type="email"
                placeholder="you@yourcompany.com"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                className="sm:max-w-xs"
              />
            </div>
          </div>

          {message ? (
            <p
              role="status"
              className={
                message.kind === 'ok'
                  ? 'text-sm text-emerald-600 dark:text-emerald-400'
                  : 'text-destructive text-sm'
              }
            >
              {message.text}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {testTo ? 'Test and save' : 'Save settings'}
            </Button>
            {saved ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setMessage(null);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
