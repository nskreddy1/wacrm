'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ChannelKind, ChannelProvider } from '@/types';

type Discovery = {
  accountName: string;
  numbers: { phoneNumber: string; label: string; smsCapable: boolean }[];
  whatsappSenders: string[];
  messagingServices: { sid: string; name: string }[];
};

export interface ChannelSetupInit {
  /** Preselected provider (from the provider card grid). */
  provider?: ChannelProvider;
  /** Prefilled Account SID (from Twilio Connect popup authorization). */
  accountSid?: string;
  /** Reuse credentials from this existing connection (dedup). */
  reuseFromId?: string;
  reuseFromLabel?: string;
  /**
   * Edit mode: update this existing connection in place. Stored
   * credentials are kept server-side unless new ones are typed, so
   * users can change the name, sender number, or Messaging Service
   * without re-entering secrets.
   */
  editId?: string;
  displayName?: string;
  externalIdentity?: string;
  messagingServiceSid?: string;
}

const CHANNEL_LABEL: Record<ChannelKind, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
};

const defaults = {
  displayName: '',
  externalIdentity: '',
  host: '',
  port: '587',
  username: '',
  password: '',
  apiKey: '',
  accountSid: '',
  authToken: '',
  messagingServiceSid: '',
  // WhatsApp Cloud API (Meta) — token + IDs from Meta for Developers.
  accessToken: '',
  phoneNumberId: '',
  appSecret: '',
  verifyToken: '',
};

/**
 * "Set up connection" sheet — same design language as the Edit Field /
 * Create Custom Field sheets (right side panel, bordered header with
 * channel chip, footer actions). Holds the credential form, the
 * Validate & Pick discovery flow, and saving. The page itself stays
 * clean: no inline advanced form.
 */
export function ChannelSetupSheet({
  channel,
  open,
  init,
  providers,
  onOpenChange,
  onSaved,
}: {
  channel: ChannelKind;
  open: boolean;
  init: ChannelSetupInit | null;
  providers: { provider: ChannelProvider; label: string; available: boolean }[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Mount-per-open: the body initializes its draft from `init`/`channel`
  // in useState initializers and remounts fresh each open cycle — no
  // re-seed effect to keep in sync with the props.
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <ChannelSetupSheetBody
          channel={channel}
          init={init}
          providers={providers}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  );
}

function ChannelSetupSheetBody({
  channel,
  init,
  providers,
  onOpenChange,
  onSaved,
}: {
  channel: ChannelKind;
  init: ChannelSetupInit | null;
  providers: { provider: ChannelProvider; label: string; available: boolean }[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<ChannelProvider>(
    () => init?.provider ?? (channel === 'email' ? 'smtp' : 'twilio')
  );
  const [form, setForm] = useState(() => ({
    ...defaults,
    accountSid: init?.accountSid ?? '',
    displayName: init?.displayName ?? '',
    externalIdentity: init?.externalIdentity ?? '',
    messagingServiceSid: init?.messagingServiceSid ?? '',
  }));
  const [busy, setBusy] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const editing = Boolean(init?.editId);
  // Edit mode implicitly reuses the row's own stored credentials —
  // secrets never round-trip to the browser (see the save route).
  const reusing = Boolean(init?.reuseFromId) || editing;

  function update(name: keyof typeof defaults, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function request(body: unknown) {
    const response = await fetch('/api/settings/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      const fieldErrors = payload.details?.fieldErrors as
        Record<string, string[]> | undefined;
      const firstField = fieldErrors
        ? Object.entries(fieldErrors).find(
            ([, messages]) => messages.length > 0
          )
        : undefined;
      throw new Error(
        firstField
          ? `${firstField[0]}: ${firstField[1][0]}`
          : (payload.error ?? 'Channel operation failed')
      );
    }
    return payload;
  }

  async function discover() {
    if (!reusing && (!form.accountSid.trim() || !form.authToken.trim())) {
      toast.error('Enter the Twilio Account SID and Auth token first.');
      return;
    }
    setBusy('discover');
    try {
      const payload = await request({
        action: 'discover',
        provider: 'twilio',
        ...(reusing
          ? { reuseCredentialsFromId: init?.reuseFromId }
          : {
              accountSid: form.accountSid.trim(),
              authToken: form.authToken.trim(),
            }),
      });
      setDiscovery(payload.discovery);
      toast.success(
        `Connected to “${payload.discovery.accountName}”. Pick your number below.`
      );
    } catch (cause) {
      setDiscovery(null);
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'Could not fetch account details'
      );
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const identityLabel =
      channel === 'email'
        ? 'sender email'
        : channel === 'sms'
          ? 'SMS number'
          : 'WhatsApp number';
    if (!form.displayName.trim()) {
      toast.error('Connection name is required.');
      return;
    }
    if (!form.externalIdentity.trim()) {
      toast.error(`The ${identityLabel} is required.`);
      return;
    }
    if (
      provider === 'twilio' &&
      !reusing &&
      (!form.accountSid.trim() || !form.authToken.trim())
    ) {
      toast.error('Twilio Account SID and Auth token are required.');
      return;
    }
    if (
      provider === 'meta' &&
      (!form.accessToken.trim() || !form.phoneNumberId.trim())
    ) {
      toast.error('Meta access token and phone number ID are required.');
      return;
    }
    if (
      provider === 'smtp' &&
      (!form.host.trim() || !form.username.trim() || !form.password.trim())
    ) {
      toast.error('SMTP host, username, and password are required.');
      return;
    }
    if (provider === 'resend' && !form.apiKey.trim()) {
      toast.error('Resend API key is required.');
      return;
    }
    setBusy('save');
    try {
      const configuration =
        provider === 'smtp'
          ? {
              host: form.host,
              port: Number(form.port),
              secure: Number(form.port) === 465,
              requireTls: Number(form.port) === 587,
            }
          : provider === 'meta'
            ? { phone_number_id: form.phoneNumberId.trim() }
            : provider === 'twilio'
              ? // Plain (non-secret) config so the Messaging Service can
                // be changed later WITHOUT retyping the auth token — the
                // adapters read configuration first, credentials second.
                {
                  messaging_service_sid: form.messagingServiceSid.trim(),
                }
              : {};
      const credentials = reusing
        ? undefined
        : provider === 'smtp'
          ? { username: form.username, password: form.password }
          : provider === 'resend'
            ? { apiKey: form.apiKey }
            : provider === 'meta'
              ? {
                  accessToken: form.accessToken.trim(),
                  ...(form.appSecret.trim()
                    ? { appSecret: form.appSecret.trim() }
                    : {}),
                  ...(form.verifyToken.trim()
                    ? { verifyToken: form.verifyToken.trim() }
                    : {}),
                }
              : {
                  accountSid: form.accountSid,
                  authToken: form.authToken,
                  ...(form.messagingServiceSid.trim()
                    ? { messagingServiceSid: form.messagingServiceSid.trim() }
                    : {}),
                };
      await request({
        action: 'save',
        ...(editing ? { id: init?.editId } : {}),
        channel,
        provider,
        displayName: form.displayName.trim(),
        externalIdentity: form.externalIdentity.trim(),
        configuration,
        credentials,
        // Edit mode keeps the row's own stored credentials server-side;
        // only an explicit "reuse from" needs the source id.
        ...(init?.reuseFromId
          ? { reuseCredentialsFromId: init.reuseFromId }
          : {}),
      });
      toast.success(
        editing
          ? 'Connection updated. Run a test to confirm delivery still works.'
          : 'Connection saved securely. Test it before enabling.'
      );
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not save connection'
      );
    } finally {
      setBusy(null);
    }
  }

  const label = CHANNEL_LABEL[channel];
  const available =
    providers.find((item) => item.provider === provider)?.available ?? false;
  const senderOptions = discovery
    ? channel === 'whatsapp' && discovery.whatsappSenders.length > 0
      ? discovery.whatsappSenders.map((num) => ({ value: num, label: num }))
      : discovery.numbers
          .filter((num) => (channel === 'sms' ? num.smsCapable : true))
          .map((num) => ({
            value: num.phoneNumber,
            label:
              num.label === num.phoneNumber
                ? num.phoneNumber
                : `${num.label} — ${num.phoneNumber}`,
          }))
    : [];

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
    >
      <SheetHeader className="border-border border-b px-5 py-4">
        <SheetTitle className="flex items-center gap-2.5 text-lg">
          Set up connection
          <Badge variant="secondary" className="rounded-full font-normal">
            {label}
          </Badge>
        </SheetTitle>
        <SheetDescription className="sr-only">
          Configure a {label} provider connection
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {channel === 'email' ? (
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              Provider
            </span>
            <Select
              value={provider}
              onValueChange={(value) => {
                if (value) setProvider(value as ChannelProvider);
              }}
            >
              <SelectTrigger className="bg-card h-8 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {providers.map((item) => (
                    <SelectItem key={item.provider} value={item.provider}>
                      {item.label}
                      {item.available ? '' : ' — coming later'}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : channel === 'whatsapp' ? (
          /* WhatsApp has two real paths: Twilio (BSP) or a direct
               Meta Cloud API connection. */
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              Provider
            </span>
            <Select
              value={provider}
              onValueChange={(value) => {
                if (value) setProvider(value as ChannelProvider);
              }}
            >
              <SelectTrigger className="bg-card h-8 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="twilio">Twilio</SelectItem>
                  <SelectItem value="meta">
                    WhatsApp Cloud API (Meta)
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              Provider
            </span>
            <span className="text-foreground text-sm font-medium">Twilio</span>
          </div>
        )}

        {reusing ? (
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-28 shrink-0 text-sm">
              Credentials
            </span>
            <span className="text-foreground text-sm font-medium">
              Reused from &ldquo;{init?.reuseFromLabel}&rdquo;
            </span>
          </div>
        ) : null}

        {!available ? (
          <Alert>
            <AlertTitle>Not available yet</AlertTitle>
            <AlertDescription>
              This provider remains selectable in the architecture, but setup is
              disabled until its real authentication flow is implemented and
              tested.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
              <span className="text-muted-foreground w-28 shrink-0 text-sm">
                Name
              </span>
              <Input
                value={form.displayName}
                onChange={(event) => update('displayName', event.target.value)}
                placeholder={
                  channel === 'email' ? 'Support inbox' : 'Sales line'
                }
                className="bg-card h-8 flex-1"
                aria-label="Connection name"
              />
            </div>

            {provider === 'twilio' && !reusing ? (
              <>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Account SID
                  </span>
                  <Input
                    value={form.accountSid}
                    onChange={(event) =>
                      update('accountSid', event.target.value)
                    }
                    placeholder="ACxxxxxxxx"
                    className="bg-card h-8 flex-1 font-mono text-xs"
                    aria-label="Twilio Account SID"
                  />
                </div>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Auth token
                  </span>
                  <Input
                    type="password"
                    value={form.authToken}
                    onChange={(event) =>
                      update('authToken', event.target.value)
                    }
                    className="bg-card h-8 flex-1"
                    aria-label="Twilio Auth token"
                  />
                </div>
              </>
            ) : null}

            {provider === 'meta' ? (
              <>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Access token
                  </span>
                  <Input
                    type="password"
                    value={form.accessToken}
                    onChange={(event) =>
                      update('accessToken', event.target.value)
                    }
                    placeholder="Permanent token (EAAG…)"
                    className="bg-card h-8 flex-1"
                    aria-label="Meta permanent access token"
                  />
                </div>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Phone number ID
                  </span>
                  <Input
                    value={form.phoneNumberId}
                    onChange={(event) =>
                      update('phoneNumberId', event.target.value)
                    }
                    placeholder="e.g. 123456789012345"
                    className="bg-card h-8 flex-1 font-mono text-xs"
                    aria-label="WhatsApp phone number ID"
                  />
                </div>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    App secret{' '}
                    <span className="block text-[11px]">(optional)</span>
                  </span>
                  <Input
                    type="password"
                    value={form.appSecret}
                    onChange={(event) =>
                      update('appSecret', event.target.value)
                    }
                    placeholder="For webhook signatures"
                    className="bg-card h-8 flex-1"
                    aria-label="Meta app secret"
                  />
                </div>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Verify token{' '}
                    <span className="block text-[11px]">(optional)</span>
                  </span>
                  <Input
                    value={form.verifyToken}
                    onChange={(event) =>
                      update('verifyToken', event.target.value)
                    }
                    placeholder="For webhook setup"
                    className="bg-card h-8 flex-1"
                    aria-label="Webhook verify token"
                  />
                </div>
                <p className="text-muted-foreground px-1 text-xs leading-relaxed">
                  Find these in Meta for Developers → your app → WhatsApp → API
                  Setup. The phone number ID is shown under the sender number.
                </p>
              </>
            ) : null}

            {provider === 'smtp' ? (
              <>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    SMTP host
                  </span>
                  <Input
                    value={form.host}
                    onChange={(event) => update('host', event.target.value)}
                    placeholder="smtp.example.com"
                    className="bg-card h-8 flex-1"
                    aria-label="SMTP host"
                  />
                </div>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Port
                  </span>
                  <Input
                    inputMode="numeric"
                    value={form.port}
                    onChange={(event) => update('port', event.target.value)}
                    className="bg-card h-8 flex-1"
                    aria-label="SMTP port"
                  />
                </div>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Username
                  </span>
                  <Input
                    autoComplete="username"
                    value={form.username}
                    onChange={(event) => update('username', event.target.value)}
                    className="bg-card h-8 flex-1"
                    aria-label="SMTP username"
                  />
                </div>
                <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm">
                    Password
                  </span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) => update('password', event.target.value)}
                    className="bg-card h-8 flex-1"
                    aria-label="SMTP password"
                  />
                </div>
              </>
            ) : null}

            {provider === 'resend' ? (
              <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                <span className="text-muted-foreground w-28 shrink-0 text-sm">
                  API key
                </span>
                <Input
                  type="password"
                  value={form.apiKey}
                  onChange={(event) => update('apiKey', event.target.value)}
                  className="bg-card h-8 flex-1"
                  aria-label="Resend API key"
                />
              </div>
            ) : null}

            {provider === 'twilio' ? (
              <div className="border-border flex flex-col gap-3 rounded-md border border-dashed px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-foreground text-sm font-medium">
                      Pick from your account
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Verify and list your numbers — no console copying.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={discover}
                    disabled={busy !== null}
                  >
                    {busy === 'discover' ? (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <CheckCircle2 data-icon="inline-start" />
                    )}
                    Fetch
                  </Button>
                </div>
                {discovery ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-muted-foreground text-xs">
                      Account:{' '}
                      <span className="text-foreground font-medium">
                        {discovery.accountName}
                      </span>
                    </p>
                    {senderOptions.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="setup-number">Sender number</Label>
                        <Select
                          value={form.externalIdentity || undefined}
                          onValueChange={(value) =>
                            update('externalIdentity', value ?? '')
                          }
                        >
                          <SelectTrigger id="setup-number" className="w-full">
                            <SelectValue placeholder="Choose a number" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {senderOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {channel === 'whatsapp' &&
                        discovery.whatsappSenders.length === 0 ? (
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            No registered WhatsApp senders found — showing all
                            account numbers. Register the number for WhatsApp in
                            the Twilio Console if sends fail.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <Alert>
                        <AlertTitle>No usable numbers found</AlertTitle>
                        <AlertDescription>
                          This account owns no{' '}
                          {channel === 'sms' ? 'SMS-capable ' : ''}phone
                          numbers. Buy a number in the Twilio Console, then
                          fetch again.
                        </AlertDescription>
                      </Alert>
                    )}
                    {discovery.messagingServices.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="setup-service">
                          Messaging Service{' '}
                          <span className="text-muted-foreground font-normal">
                            (optional)
                          </span>
                        </Label>
                        <Select
                          value={form.messagingServiceSid || 'none'}
                          onValueChange={(value) =>
                            update(
                              'messagingServiceSid',
                              !value || value === 'none' ? '' : value
                            )
                          }
                        >
                          <SelectTrigger id="setup-service" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">
                                None — send from the number directly
                              </SelectItem>
                              {discovery.messagingServices.map((service) => (
                                <SelectItem
                                  key={service.sid}
                                  value={service.sid}
                                >
                                  {service.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Manual Messaging Service entry — covers edit mode, where
                discovery hasn't run (it needs the auth token, which we
                never round-trip to the browser). Paste or clear the MG…
                SID directly without re-entering credentials. */}
            {provider === 'twilio' && !discovery ? (
              <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
                <span className="text-muted-foreground w-28 shrink-0 text-sm">
                  Messaging Service
                </span>
                <Input
                  value={form.messagingServiceSid}
                  onChange={(event) =>
                    update('messagingServiceSid', event.target.value)
                  }
                  placeholder="MGxxxxxxxx (optional — blank sends from the number)"
                  className="bg-card h-8 flex-1 font-mono text-xs"
                  aria-label="Messaging Service SID"
                />
              </div>
            ) : null}

            <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
              <span className="text-muted-foreground w-28 shrink-0 text-sm">
                {channel === 'email' ? 'Sender email' : `${label} number`}
              </span>
              <Input
                type={channel === 'email' ? 'email' : 'tel'}
                value={form.externalIdentity}
                onChange={(event) =>
                  update('externalIdentity', event.target.value)
                }
                placeholder={
                  channel === 'email' ? 'support@example.com' : '+15551234567'
                }
                className="bg-card h-8 flex-1"
                aria-label={
                  channel === 'email' ? 'Sender email' : `${label} number`
                }
              />
            </div>
          </>
        )}
      </div>

      <SheetFooter className="border-border flex-row justify-end gap-2 border-t px-5 py-4">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy !== null || !available}>
          {busy === 'save' ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : null}
          Save
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}
