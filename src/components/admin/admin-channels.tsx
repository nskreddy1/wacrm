"use client";

// ============================================================
// AdminChannels — /admin/channels (per-tenant channel credentials).
//
// Pick a workspace, then manage its four channel slots
// (whatsapp / sms / email / voice). Secrets are write-only:
// the API encrypts them server-side and only ever returns a
// masked preview, so this UI never holds live credentials.
// Test-connection runs a decrypt round-trip server-side.
// ============================================================

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  PlugZap,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

const CHANNELS = ["whatsapp", "sms", "email", "voice"] as const;
type Channel = (typeof CHANNELS)[number];

const CHANNEL_META: Record<
  Channel,
  { title: string; description: string; providers: string[] }
> = {
  whatsapp: {
    title: "WhatsApp",
    description: "WhatsApp Business API credentials for this workspace.",
    providers: ["meta_cloud", "twilio", "360dialog"],
  },
  sms: {
    title: "SMS",
    description: "SMS provider credentials for outbound and inbound texts.",
    providers: ["twilio", "vonage", "messagebird"],
  },
  email: {
    title: "Email",
    description: "Transactional email provider for this workspace.",
    providers: ["resend", "sendgrid", "postmark", "ses"],
  },
  voice: {
    title: "Voice",
    description: "Voice-call provider credentials.",
    providers: ["twilio", "vonage"],
  },
};

interface ChannelRow {
  id: string;
  account_id: string;
  channel: Channel;
  provider: string;
  masked_preview: string | null;
  is_active: boolean;
  verified_at: string | null;
  updated_at: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

const jsonFetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Request failed");
  return body;
};

export function AdminChannels() {
  const [accountId, setAccountId] = useState<string | null>(null);

  // Workspace picker sources the first page of the directory; the
  // super admin can search there if the tenant list grows past it.
  const { data: wsData, isLoading: wsLoading } = useSWR<{
    workspaces: WorkspaceOption[];
  }>("/api/admin/workspaces", jsonFetcher);
  const workspaces = wsData?.workspaces ?? [];

  const {
    data: channelData,
    isLoading: channelsLoading,
    mutate,
  } = useSWR<{ channels: ChannelRow[]; encryption_ready: boolean }>(
    accountId ? `/api/admin/channels?account_id=${accountId}` : null,
    jsonFetcher,
  );

  const byChannel = new Map<Channel, ChannelRow>(
    (channelData?.channels ?? []).map((c) => [c.channel, c]),
  );

  return (
    <section
      className="flex flex-col gap-4"
      aria-label="Channel configuration"
    >
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="channel-workspace">Workspace</Label>
        <Select
          value={accountId}
          onValueChange={(v) => {
            if (v !== null) setAccountId(v);
          }}
        >
          <SelectTrigger id="channel-workspace" aria-label="Select workspace">
            <SelectValue placeholder="Select a workspace…" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {wsLoading && (
          <p className="text-xs text-muted-foreground">Loading workspaces…</p>
        )}
      </div>

      {!accountId ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Select a workspace to manage its channel provider credentials.
        </p>
      ) : channelsLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {CHANNELS.map((c) => (
            <Skeleton key={c} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {channelData && !channelData.encryption_ready && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              CHANNEL_CREDENTIALS_KEY is not set on the server. Credentials
              cannot be stored until it is configured.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {CHANNELS.map((channel) => (
              <ChannelCard
                key={channel}
                accountId={accountId}
                channel={channel}
                row={byChannel.get(channel) ?? null}
                encryptionReady={channelData?.encryption_ready ?? false}
                onChanged={() => void mutate()}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ChannelCard({
  accountId,
  channel,
  row,
  encryptionReady,
  onChanged,
}: {
  accountId: string;
  channel: Channel;
  row: ChannelRow | null;
  encryptionReady: boolean;
  onChanged: () => void;
}) {
  const meta = CHANNEL_META[channel];
  const [configureOpen, setConfigureOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, channel, ...payload }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Request failed");
      onChanged();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="grid leading-tight">
          <h3 className="text-sm font-semibold">{meta.title}</h3>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        {row ? (
          <Badge variant={row.is_active ? "default" : "secondary"}>
            {row.is_active ? "Active" : "Inactive"}
          </Badge>
        ) : (
          <Badge variant="outline">Not configured</Badge>
        )}
      </header>

      {row ? (
        <dl className="grid gap-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Provider</dt>
            <dd className="font-medium">{row.provider}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Credential</dt>
            <dd className="font-mono text-xs">
              {row.masked_preview ?? "stored"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Verified</dt>
            <dd>
              {row.verified_at ? (
                <span className="flex items-center gap-1 text-xs">
                  <ShieldCheck
                    className="size-3.5 text-primary"
                    aria-hidden="true"
                  />
                  {new Date(row.verified_at).toLocaleString()}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Not verified
                </span>
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          No credentials stored for this channel yet.
        </p>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          variant={row ? "outline" : "default"}
          disabled={busy || !encryptionReady}
          onClick={() => setConfigureOpen(true)}
        >
          <KeyRound className="size-4" aria-hidden="true" />
          {row ? "Rotate credentials" : "Configure"}
        </Button>
        {row && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void patch({ action: "test" }).then(
                  (ok) => ok && toast.success("Connection test passed"),
                )
              }
            >
              <PlugZap className="size-4" aria-hidden="true" />
              Test connection
            </Button>
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              {busy && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              )}
              Active
              <Switch
                checked={row.is_active}
                disabled={busy}
                aria-label={`Toggle ${meta.title} channel`}
                onCheckedChange={(checked) =>
                  void patch({ is_active: checked })
                }
              />
            </label>
          </>
        )}
      </footer>

      <ConfigureChannelDialog
        accountId={accountId}
        channel={channel}
        providers={meta.providers}
        currentProvider={row?.provider ?? null}
        open={configureOpen}
        onOpenChange={setConfigureOpen}
        onSaved={onChanged}
      />
    </article>
  );
}

function ConfigureChannelDialog({
  accountId,
  channel,
  providers,
  currentProvider,
  open,
  onOpenChange,
  onSaved,
}: {
  accountId: string;
  channel: Channel;
  providers: string[];
  currentProvider: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<string | null>(currentProvider);
  const [credentialId, setCredentialId] = useState("");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [sender, setSender] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!provider) {
      toast.error("Choose a provider first");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          channel,
          provider,
          credentials: {
            credential_id: credentialId,
            credential_secret: credentialSecret,
            sender,
          },
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to save credentials");
      toast.success("Credentials stored (encrypted at rest)");
      onSaved();
      reset(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function reset(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setCredentialId("");
      setCredentialSecret("");
      setSender("");
      setProvider(currentProvider);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="capitalize">
            Configure {channel} channel
          </DialogTitle>
          <DialogDescription>
            Secrets are encrypted server-side before storage and are never
            shown again — only a masked preview remains visible.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${channel}-provider`}>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger
                id={`${channel}-provider`}
                aria-label="Select provider"
              >
                <SelectValue placeholder="Select a provider…" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${channel}-cred-id`}>
              Account SID / API key ID
            </Label>
            <Input
              id={`${channel}-cred-id`}
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${channel}-cred-secret`}>
              Auth token / API secret
            </Label>
            <Input
              id={`${channel}-cred-secret`}
              type="password"
              value={credentialSecret}
              onChange={(e) => setCredentialSecret(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${channel}-sender`}>
              Sender ID / phone number{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id={`${channel}-sender`}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => reset(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              Save credentials
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
