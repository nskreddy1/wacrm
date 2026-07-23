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
import type { ChannelKind } from '@/types'

interface ConnectChannelDialogProps {
  channel: ChannelKind
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Twilio Connect authorize URL, when the Connect App is configured. */
  authorizeUrl: string | null
  /** Called with the customer's Twilio Account SID after they authorize. */
  onAuthorized: (accountSid: string) => void
  /** Called when guided connect is unavailable — opens manual setup. */
  onFallbackToManual: () => void
}

const CHANNEL_LABEL: Record<ChannelKind, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
}

/**
 * Bigin-style guided connect modal: explains the popup, requires a
 * terms acknowledgement, then opens the Twilio Connect authorize popup.
 * The popup redirects to our callback route, which postMessages the
 * authorized Account SID back to this window.
 */
export function ConnectChannelDialog({ channel, open, onOpenChange, authorizeUrl, onAuthorized, onFallbackToManual }: ConnectChannelDialogProps) {
  const [agreed, setAgreed] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const popupRef = useRef<Window | null>(null)
  const label = CHANNEL_LABEL[channel]

  // Listen for the callback route's postMessage from the popup.
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as { source?: string; accountSid?: string; denied?: boolean }
      if (payload?.source !== 'twilio-connect') return
      setWaiting(false)
      if (payload.denied || !payload.accountSid) return
      onAuthorized(payload.accountSid)
      onOpenChange(false)
    },
    [onAuthorized, onOpenChange],
  )

  useEffect(() => {
    if (!open) return
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [open, handleMessage])

  // Reset transient state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setAgreed(false)
      setWaiting(false)
    }
  }, [open])

  function startConnect() {
    if (!authorizeUrl) {
      onOpenChange(false)
      onFallbackToManual()
      return
    }
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
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect your {label} account</DialogTitle>
          <DialogDescription>
            In the next step, a popup window will ask you to sign in to
            Twilio and authorize this workspace to access your account —
            we never see your password or auth token.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Alert className="border-amber-500/30 bg-amber-500/10">
            <AlertDescription className="text-foreground/85">
              Make sure popups are allowed in your browser settings.
              Otherwise you can&apos;t complete the sign-in process to
              link your {label} account.
            </AlertDescription>
          </Alert>
          {!authorizeUrl ? (
            <Alert>
              <AlertDescription>
                One-click connect isn&apos;t configured on this
                deployment yet (missing Twilio Connect App). You can
                continue with manual setup instead.
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
          <Button onClick={startConnect} disabled={!agreed || waiting}>
            {waiting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {waiting ? 'Waiting for authorization…' : authorizeUrl ? `Connect ${label}` : 'Continue with manual setup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
