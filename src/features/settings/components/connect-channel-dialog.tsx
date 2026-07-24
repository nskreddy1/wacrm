'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ChannelKind } from '@/types'

export type ConnectMethod = 'twilio-popup' | 'twilio-manual' | 'twilio-reuse' | 'meta-cloud'

interface ConnectChannelDialogProps {
  channel: ChannelKind
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Twilio Connect authorize URL, when the Connect App is configured. */
  authorizeUrl: string | null
  /** An existing Twilio connection on the other channel (dedup). */
  reusable: { id: string; displayName: string; channelLabel: string } | null
  /**
   * Called when the user picks a method and continues. For
   * 'twilio-popup' this fires AFTER authorization with the Account SID.
   */
  onContinue: (result: { method: ConnectMethod; accountSid?: string; reuseFromId?: string }) => void
}

const CHANNEL_LABEL: Record<ChannelKind, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
}

/**
 * Bigin-style guided connect modal with a connection-method dropdown:
 * one-click Twilio Connect popup (when configured), manual credentials,
 * reuse of the Twilio account already connected on the other channel
 * (fixes WhatsApp/SMS credential duplication), and a disabled
 * placeholder for Meta Cloud API until Tech Provider approval.
 */
export function ConnectChannelDialog({ channel, open, onOpenChange, authorizeUrl, reusable, onContinue }: ConnectChannelDialogProps) {
  // Mount-per-open: the body initializes its transient state (agreement,
  // preselected method) in useState initializers and remounts fresh each
  // open cycle — no reset effect to keep in sync with the props.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ConnectChannelDialogBody
          channel={channel}
          onOpenChange={onOpenChange}
          authorizeUrl={authorizeUrl}
          reusable={reusable}
          onContinue={onContinue}
        />
      )}
    </Dialog>
  )
}

function ConnectChannelDialogBody({
  channel,
  onOpenChange,
  authorizeUrl,
  reusable,
  onContinue,
}: Omit<ConnectChannelDialogProps, 'open'>) {
  const [agreed, setAgreed] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [method, setMethod] = useState<ConnectMethod | null>(
    () => (authorizeUrl ? 'twilio-popup' : reusable ? 'twilio-reuse' : 'twilio-manual'),
  )
  const popupRef = useRef<Window | null>(null)
  const label = CHANNEL_LABEL[channel]

  // Listen for the callback route's postMessage from the popup. The
  // subscription lives for the body's lifetime (i.e. while open).
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as { source?: string; accountSid?: string; denied?: boolean }
      if (payload?.source !== 'twilio-connect') return
      setWaiting(false)
      if (payload.denied || !payload.accountSid) return
      onContinue({ method: 'twilio-popup', accountSid: payload.accountSid })
      onOpenChange(false)
    },
    [onContinue, onOpenChange],
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  function startConnect() {
    if (!method) return
    if (method === 'twilio-popup' && authorizeUrl) {
      const width = 720
      const height = 780
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)
      popupRef.current = window.open(
        authorizeUrl,
        'twilio-connect-authorize',
        `width=${width},height=${height},left=${left},top=${top}`,
      )
      if (!popupRef.current) return
      setWaiting(true)
      return
    }
    if (method === 'twilio-reuse' && reusable) {
      onContinue({ method, reuseFromId: reusable.id })
      onOpenChange(false)
      return
    }
    onContinue({ method: 'twilio-manual' })
    onOpenChange(false)
  }

  return (
    <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect your {label} account</DialogTitle>
          <DialogDescription>
            Choose how you want to connect. With one-click sign-in, a
            popup asks you to authorize your provider account — we never
            see your password or auth token.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="connect-method">Connection method</Label>
            <Select value={method ?? undefined} onValueChange={(value) => { if (value) setMethod(value as ConnectMethod) }}>
              <SelectTrigger id="connect-method" className="w-full">
                <SelectValue placeholder="Select a connection method" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {authorizeUrl ? (
                    <SelectItem value="twilio-popup">Twilio — one-click sign in (recommended)</SelectItem>
                  ) : null}
                  {reusable ? (
                    <SelectItem value="twilio-reuse">
                      Use existing Twilio account — &ldquo;{reusable.displayName}&rdquo; ({reusable.channelLabel})
                    </SelectItem>
                  ) : null}
                  <SelectItem value="twilio-manual">Twilio — enter credentials manually</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {method === 'twilio-reuse' && reusable ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                The Account SID and Auth token stored for {reusable.channelLabel} are
                copied server-side — no retyping, and secrets never reach this browser.
              </p>
            ) : null}
          </div>
          {method === 'twilio-popup' ? (
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <AlertDescription className="text-foreground/85">
                Make sure popups are allowed in your browser settings.
                Otherwise you can&apos;t complete the sign-in process to
                link your {label} account.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-start gap-3">
            <Checkbox
              id="connect-terms"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="connect-terms" className="text-sm leading-relaxed font-normal text-foreground/85">
              I authorize this workspace to access my provider account
              for sending and receiving {label} messages, and I have
              read the provider&apos;s messaging policies.
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={startConnect} disabled={!agreed || waiting || !method}>
            {waiting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {waiting ? 'Waiting for authorization…' : `Connect ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
  )
}
