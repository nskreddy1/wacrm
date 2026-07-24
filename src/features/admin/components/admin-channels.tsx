'use client'

// ============================================================
// AdminChannels — /admin/channels (platform console).
//
// Founder/support view of client channel connections. Works on
// the SAME channel_connections rows the client sees in their
// Settings → WhatsApp / SMS / Email pages:
//   • provision a platform-managed connection for a client
//   • fix/rotate credentials on a client's broken connection
//   • test, enable/disable, or remove any connection
// Secrets are write-only; the server encrypts and never returns
// them. Every action is written to the platform audit log.
// ============================================================

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Lock, Mail, Megaphone, MessageCircle, MoreHorizontal, PlugZap, Plus, ShieldCheck, Smartphone, Trash2, Wrench } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ChannelConnection, ChannelKind, ChannelProvider } from '@/types'

type Connection = ChannelConnection & { providerLabel: string }
type WorkspaceOption = { id: string; name: string }

const CHANNELS: ChannelKind[] = ['whatsapp', 'sms', 'email']
const CHANNEL_LABEL: Record<ChannelKind, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' }
const CHANNEL_ICON: Record<ChannelKind, typeof Mail> = { whatsapp: MessageCircle, sms: Smartphone, email: Mail }

/** Providers offered per channel in the provision sheet. */
const CHANNEL_PROVIDERS: Record<ChannelKind, { value: ChannelProvider; label: string }[]> = {
  whatsapp: [
    { value: 'twilio', label: 'Twilio' },
    { value: 'meta', label: 'WhatsApp Cloud API (Meta)' },
  ],
  sms: [{ value: 'twilio', label: 'Twilio' }],
  email: [
    { value: 'smtp', label: 'SMTP' },
    { value: 'resend', label: 'Resend' },
  ],
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  connected: { label: 'Connected', variant: 'default' },
  degraded: { label: 'Degraded', variant: 'destructive' },
  draft: { label: 'Not tested', variant: 'secondary' },
  disconnected: { label: 'Disconnected', variant: 'outline' },
}

const jsonFetcher = async (url: string) => {
  const res = await fetch(url)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? 'Request failed')
  return body
}

export function AdminChannels() {
  const [accountId, setAccountId] = useState<string | null>(null)

  const { data: wsData, isLoading: wsLoading } = useSWR<{ workspaces: WorkspaceOption[] }>(
    '/api/admin/workspaces',
    jsonFetcher,
  )
  const workspaces = wsData?.workspaces ?? []

  const { data, isLoading, mutate } = useSWR<{ connections: Connection[] }>(
    accountId ? `/api/admin/channels?account_id=${accountId}` : null,
    jsonFetcher,
  )
  const connections = data?.connections ?? []

  return (
    <section className="flex flex-col gap-5" aria-label="Client channel configuration">
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="channel-workspace">Client workspace</Label>
        <Select
          value={accountId}
          onValueChange={(value) => {
            if (value !== null) setAccountId(value)
          }}
        >
          <SelectTrigger id="channel-workspace" aria-label="Select workspace">
            <SelectValue placeholder={wsLoading ? 'Loading workspaces…' : 'Select a workspace…'} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {!accountId ? (
        <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          Select a client workspace to view and manage its channel connections.
        </p>
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-64 rounded-md" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : (
        <ChannelTabs accountId={accountId} connections={connections} onChanged={() => void mutate()} />
      )}
    </section>
  )
}

// ------------------------------------------------------------------
// Tabs per channel with connection rows + provision button.
// ------------------------------------------------------------------

function ChannelTabs({
  accountId,
  connections,
  onChanged,
}: {
  accountId: string
  connections: Connection[]
  onChanged: () => void
}) {
  const [tab, setTab] = useState<ChannelKind>('whatsapp')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Connection | null>(null)

  const byChannel = useMemo(() => {
    const map: Record<ChannelKind, Connection[]> = { whatsapp: [], sms: [], email: [] }
    for (const connection of connections) map[connection.channel]?.push(connection)
    return map
  }, [connections])

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ChannelKind)}>
      <TabsList>
        {CHANNELS.map((channel) => (
          <TabsTrigger key={channel} value={channel}>
            {CHANNEL_LABEL[channel]}
            {byChannel[channel].length > 0 ? (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {byChannel[channel].length}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      {CHANNELS.map((channel) => (
        <TabsContent key={channel} value={channel} className="flex flex-col gap-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {byChannel[channel].length === 0
                ? `No ${CHANNEL_LABEL[channel]} connections for this workspace yet.`
                : `${byChannel[channel].length} connection${byChannel[channel].length === 1 ? '' : 's'}`}
            </p>
            <Button
              size="sm"
              onClick={() => {
                setEditTarget(null)
                setSheetOpen(true)
              }}
            >
              <Plus data-icon="inline-start" aria-hidden />
              Provision connection
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {byChannel[channel].map((connection) => (
              <ConnectionRow
                key={connection.id}
                accountId={accountId}
                connection={connection}
                onChanged={onChanged}
                onEdit={() => {
                  setEditTarget(connection)
                  setSheetOpen(true)
                }}
              />
            ))}
          </div>
        </TabsContent>
      ))}

      <ProvisionSheet
        accountId={accountId}
        channel={tab}
        connection={editTarget}
        open={sheetOpen}
        onOpenChange={(next) => {
          setSheetOpen(next)
          if (!next) setEditTarget(null)
        }}
        onSaved={onChanged}
      />
    </Tabs>
  )
}

// ------------------------------------------------------------------
// A single connection row — status, origin, test / toggle / actions.
// ------------------------------------------------------------------

function ConnectionRow({
  accountId,
  connection,
  onChanged,
  onEdit,
}: {
  accountId: string
  connection: Connection
  onChanged: () => void
  onEdit: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [governanceOpen, setGovernanceOpen] = useState(false)
  const Icon = CHANNEL_ICON[connection.channel]
  const status = STATUS_BADGE[connection.status] ?? STATUS_BADGE.draft
  const isPlatform = connection.managed_by === 'platform'
  const toggleLocked = connection.client_can_toggle === false

  async function patch(payload: Record<string, unknown>, key: string) {
    setBusy(key)
    try {
      const res = await fetch('/api/admin/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, id: connection.id, ...payload }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? body?.health?.error ?? 'Request failed')
      onChanged()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
      onChanged()
      return false
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    try {
      const res = await fetch(
        `/api/admin/channels?id=${connection.id}&account_id=${accountId}`,
        { method: 'DELETE' },
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to delete')
      toast.success('Connection removed')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
      setConfirmDelete(false)
    }
  }

  return (
    <article className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft">
        {connection.provider === 'twilio' ? (
          <BrandIcon src="/icons/brands/twilio.svg" size={20} />
        ) : connection.provider === 'meta' ? (
          <BrandIcon src="/icons/brands/whatsapp.svg" size={20} />
        ) : (
          <Icon className="size-4.5 text-primary" aria-hidden />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">{connection.display_name}</h3>
          <Badge variant={status.variant}>{status.label}</Badge>
          <Badge variant="outline" className="gap-1">
            {isPlatform ? <ShieldCheck className="size-3" aria-hidden /> : null}
            {isPlatform ? 'Platform managed' : 'Client connected'}
          </Badge>
          {toggleLocked ? (
            <Badge variant="secondary" className="gap-1">
              <Lock className="size-3" aria-hidden />
              Toggle locked
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {connection.providerLabel} · {connection.external_identity}
          {connection.last_error ? ` · ${connection.last_error}` : ''}
        </p>
        {connection.platform_notice ? (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-amber-600 dark:text-amber-500">
            <Megaphone className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{connection.platform_notice}</span>
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            void patch({ action: 'test' }, 'test').then((ok) => {
              if (ok) toast.success('Connection test passed')
            })
          }
        >
          {busy === 'test' ? (
            <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden />
          ) : (
            <PlugZap data-icon="inline-start" aria-hidden />
          )}
          Test
        </Button>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="sr-only">Enable {connection.display_name}</span>
          <Switch
            checked={connection.is_enabled}
            disabled={busy !== null}
            aria-label={`Toggle ${connection.display_name}`}
            onCheckedChange={(checked) => void patch({ isEnabled: checked }, 'toggle')}
          />
        </label>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
            aria-label={`More actions for ${connection.display_name}`}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Wrench className="size-4" aria-hidden />
              {isPlatform ? 'Edit / rotate credentials' : 'Fix client configuration'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGovernanceOpen(true)}>
              <Megaphone className="size-4" aria-hidden />
              Client access &amp; notice
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden />
              Remove connection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <GovernanceDialog
        accountId={accountId}
        connection={connection}
        open={governanceOpen}
        onOpenChange={setGovernanceOpen}
        onSaved={onChanged}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this connection?</AlertDialogTitle>
            <AlertDialogDescription>
              {`“${connection.display_name}” will stop sending and receiving immediately. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy === 'delete'} onClick={() => void remove()}>
              {busy === 'delete' ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}

// ------------------------------------------------------------------
// Provision / edit sheet — same "create field" sheet design used in
// Settings (labeled rows on bg-muted/40).
// ------------------------------------------------------------------

const FORM_DEFAULTS = {
  displayName: '',
  externalIdentity: '',
  accountSid: '',
  authToken: '',
  messagingServiceSid: '',
  accessToken: '',
  phoneNumberId: '',
  host: '',
  port: '587',
  username: '',
  password: '',
  apiKey: '',
}

function ProvisionSheet({
  accountId,
  channel,
  connection,
  open,
  onOpenChange,
  onSaved,
}: {
  accountId: string
  channel: ChannelKind
  connection: Connection | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const editing = connection !== null
  const targetChannel = connection?.channel ?? channel
  const providerOptions = CHANNEL_PROVIDERS[targetChannel]
  const [provider, setProvider] = useState<ChannelProvider>(providerOptions[0].value)
  const [form, setForm] = useState(FORM_DEFAULTS)
  const [takeover, setTakeover] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastOpen, setLastOpen] = useState(false)

  // Reset draft state each time the sheet opens (render-time reset,
  // no effect needed).
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setProvider((connection?.provider as ChannelProvider) ?? providerOptions[0].value)
      setForm({
        ...FORM_DEFAULTS,
        displayName: connection?.display_name ?? '',
        externalIdentity: connection?.external_identity ?? '',
      })
      setTakeover(false)
    }
  }

  function update(key: keyof typeof FORM_DEFAULTS, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const credentialsSupplied =
    provider === 'twilio'
      ? form.accountSid.trim() !== '' || form.authToken.trim() !== ''
      : provider === 'meta'
        ? form.accessToken.trim() !== ''
        : provider === 'smtp'
          ? form.username.trim() !== '' || form.password.trim() !== ''
          : form.apiKey.trim() !== ''

  async function save() {
    if (!form.displayName.trim() || !form.externalIdentity.trim()) {
      toast.error('Name and sender identity are required.')
      return
    }
    if (!editing && !credentialsSupplied) {
      toast.error('Credentials are required for a new connection.')
      return
    }
    setSaving(true)
    try {
      const credentials = !credentialsSupplied
        ? undefined
        : provider === 'twilio'
          ? {
              accountSid: form.accountSid.trim(),
              authToken: form.authToken.trim(),
              ...(form.messagingServiceSid.trim() ? { messagingServiceSid: form.messagingServiceSid.trim() } : {}),
            }
          : provider === 'meta'
            ? { accessToken: form.accessToken.trim() }
            : provider === 'smtp'
              ? { username: form.username.trim(), password: form.password }
              : { apiKey: form.apiKey.trim() }

      const configuration =
        provider === 'meta'
          ? { phone_number_id: form.phoneNumberId.trim() }
          : provider === 'smtp'
            ? { host: form.host.trim(), port: Number(form.port), secure: Number(form.port) === 465 }
            : {}

      const res = await fetch('/api/admin/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          ...(connection ? { id: connection.id } : {}),
          channel: targetChannel,
          provider,
          displayName: form.displayName.trim(),
          externalIdentity: form.externalIdentity.trim(),
          configuration,
          ...(credentials ? { credentials } : {}),
          ...(editing && !isPlatformManaged && takeover ? { takeover: true } : {}),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to save connection')
      toast.success(
        editing
          ? 'Connection updated. Run a test before enabling.'
          : 'Connection provisioned. Run a test before enabling.',
      )
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const isPlatformManaged = connection?.managed_by === 'platform'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {editing ? `Edit ${CHANNEL_LABEL[targetChannel]} connection` : `Provision ${CHANNEL_LABEL[targetChannel]} connection`}
          </SheetTitle>
          <SheetDescription>
            {editing
              ? 'Update this connection on behalf of the client. Leave credential fields blank to keep the stored secrets.'
              : 'Set up this channel for the client. They will see it in their Settings and can enable or disable it, but not edit it.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
            <span className="w-28 shrink-0 text-sm text-muted-foreground">Provider</span>
            {editing ? (
              <span className="text-sm font-medium text-foreground">
                {providerOptions.find((option) => option.value === provider)?.label ?? provider}
              </span>
            ) : (
              <Select value={provider} onValueChange={(value) => { if (value) setProvider(value as ChannelProvider) }}>
                <SelectTrigger className="h-8 flex-1 bg-card"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {providerOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
            <span className="w-28 shrink-0 text-sm text-muted-foreground">Name</span>
            <Input
              value={form.displayName}
              onChange={(event) => update('displayName', event.target.value)}
              placeholder="e.g. Acme Support Line"
              className="h-8 flex-1 bg-card"
              aria-label="Connection name"
            />
          </div>

          <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
            <span className="w-28 shrink-0 text-sm text-muted-foreground">
              {targetChannel === 'email' ? 'From address' : 'Phone number'}
            </span>
            <Input
              value={form.externalIdentity}
              onChange={(event) => update('externalIdentity', event.target.value)}
              placeholder={targetChannel === 'email' ? 'support@client.com' : '+14155551234'}
              className="h-8 flex-1 bg-card"
              aria-label={targetChannel === 'email' ? 'From address' : 'Sender phone number'}
            />
          </div>

          {provider === 'twilio' ? (
            <>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Account SID</span>
                <Input
                  value={form.accountSid}
                  onChange={(event) => update('accountSid', event.target.value)}
                  placeholder={editing ? 'Unchanged' : 'AC…'}
                  className="h-8 flex-1 bg-card font-mono text-xs"
                  aria-label="Twilio Account SID"
                />
              </div>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Auth token</span>
                <Input
                  type="password"
                  value={form.authToken}
                  onChange={(event) => update('authToken', event.target.value)}
                  placeholder={editing ? 'Unchanged' : 'Twilio auth token'}
                  autoComplete="new-password"
                  className="h-8 flex-1 bg-card"
                  aria-label="Twilio auth token"
                />
              </div>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">
                  Messaging Service <span className="block text-[11px]">(optional)</span>
                </span>
                <Input
                  value={form.messagingServiceSid}
                  onChange={(event) => update('messagingServiceSid', event.target.value)}
                  placeholder="MG…"
                  className="h-8 flex-1 bg-card font-mono text-xs"
                  aria-label="Twilio Messaging Service SID"
                />
              </div>
            </>
          ) : null}

          {provider === 'meta' ? (
            <>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Access token</span>
                <Input
                  type="password"
                  value={form.accessToken}
                  onChange={(event) => update('accessToken', event.target.value)}
                  placeholder={editing ? 'Unchanged' : 'Permanent token (EAAG…)'}
                  autoComplete="new-password"
                  className="h-8 flex-1 bg-card"
                  aria-label="Meta permanent access token"
                />
              </div>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Phone number ID</span>
                <Input
                  value={form.phoneNumberId}
                  onChange={(event) => update('phoneNumberId', event.target.value)}
                  placeholder="e.g. 123456789012345"
                  className="h-8 flex-1 bg-card font-mono text-xs"
                  aria-label="WhatsApp phone number ID"
                />
              </div>
            </>
          ) : null}

          {provider === 'smtp' ? (
            <>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Host</span>
                <Input
                  value={form.host}
                  onChange={(event) => update('host', event.target.value)}
                  placeholder="smtp.client.com"
                  className="h-8 flex-1 bg-card"
                  aria-label="SMTP host"
                />
              </div>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Port</span>
                <Input
                  value={form.port}
                  onChange={(event) => update('port', event.target.value)}
                  placeholder="587"
                  className="h-8 flex-1 bg-card"
                  aria-label="SMTP port"
                />
              </div>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Username</span>
                <Input
                  value={form.username}
                  onChange={(event) => update('username', event.target.value)}
                  placeholder={editing ? 'Unchanged' : 'SMTP username'}
                  className="h-8 flex-1 bg-card"
                  aria-label="SMTP username"
                />
              </div>
              <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">Password</span>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(event) => update('password', event.target.value)}
                  placeholder={editing ? 'Unchanged' : 'SMTP password'}
                  autoComplete="new-password"
                  className="h-8 flex-1 bg-card"
                  aria-label="SMTP password"
                />
              </div>
            </>
          ) : null}

          {provider === 'resend' ? (
            <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
              <span className="w-28 shrink-0 text-sm text-muted-foreground">API key</span>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(event) => update('apiKey', event.target.value)}
                placeholder={editing ? 'Unchanged' : 're_…'}
                autoComplete="new-password"
                className="h-8 flex-1 bg-card"
                aria-label="Resend API key"
              />
            </div>
          ) : null}

          {editing && !isPlatformManaged ? (
            <label className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-4 py-3">
              <Checkbox
                checked={takeover}
                onCheckedChange={(checked) => setTakeover(checked === true)}
                aria-label="Convert to platform managed"
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">Take over management</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Convert this client-connected channel to platform-managed. The client keeps enable/disable control
                  but can no longer edit credentials.
                </span>
              </span>
            </label>
          ) : null}

          <div className="flex items-start gap-2 rounded-md bg-primary-soft px-4 py-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Secrets are encrypted server-side and never shown again. New and updated connections start disabled —
              run a connection test, then enable.
            </p>
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden /> : null}
            {editing ? 'Save changes' : 'Provision connection'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ------------------------------------------------------------------
// Governance sheet — controls what the CLIENT can do with this
// connection: enable/disable permission + a support-authored notice
// (e.g. "Number under Twilio carrier review"). Same labeled-row
// design as the create-field sheet.
// ------------------------------------------------------------------

function GovernanceDialog({
  accountId,
  connection,
  open,
  onOpenChange,
  onSaved,
}: {
  accountId: string
  connection: Connection
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [canToggle, setCanToggle] = useState(true)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastOpen, setLastOpen] = useState(false)

  // Render-time reset each time the sheet opens.
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setCanToggle(connection.client_can_toggle !== false)
      setNotice(connection.platform_notice ?? '')
    }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          id: connection.id,
          clientCanToggle: canToggle,
          platformNotice: notice.trim() || null,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to save settings')
      toast.success('Client access settings saved')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Client access &amp; notice</SheetTitle>
          <SheetDescription>
            {`Control what the client can do with “${connection.display_name}” and post a status message they will see in their Settings.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Client can enable / disable</span>
              <span className="text-xs text-muted-foreground">
                Turn off to lock the toggle — e.g. while the number is under carrier review.
              </span>
            </div>
            <Switch
              checked={canToggle}
              onCheckedChange={setCanToggle}
              aria-label="Client can enable or disable this connection"
            />
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-4 py-3.5">
            <span className="text-sm font-medium text-foreground">Status notice for the client</span>
            <Textarea
              value={notice}
              onChange={(event) => setNotice(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="e.g. This number is pending Twilio verification — expected back online Friday. Contact support with questions."
              aria-label="Status notice shown to the client"
              className="bg-card"
            />
            <span className="text-xs text-muted-foreground">
              Shown on the connection in the client&apos;s Settings{canToggle ? '.' : ' and as the reason the toggle is locked.'} Leave empty to clear.
            </span>
          </div>

          {!canToggle && !notice.trim() ? (
            <p className="rounded-md bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              Locking without a notice shows the client a generic &quot;contact support&quot; message. Adding a short
              reason avoids confusion and support tickets.
            </p>
          ) : null}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden /> : null}
            Save settings
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
