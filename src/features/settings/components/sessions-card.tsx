'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';

export function SessionsCard() {
  const t = useTranslations('Settings.profile');
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onConfirm = async () => {
    setSigningOut(true);
    try {
      const response = await fetch('/api/v1/session', { method: 'DELETE' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string } | string;
        } | null;
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : (payload?.error?.message ?? 'Unable to sign out');
        toast.error(t('signOutFailed', { message }));
        return;
      }
      window.location.href = '/login';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <LogOut className="text-primary size-4" />
            {t('sessionsTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('sessionsDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <LogOut className="size-4" />
            {t('signOutAll')}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('signOutConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('signOutConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={signingOut}
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={onConfirm} disabled={signingOut}>
              {signingOut ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('signingOut')}
                </>
              ) : (
                t('signOutEverywhere')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
