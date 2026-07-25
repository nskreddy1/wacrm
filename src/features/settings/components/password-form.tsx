'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, KeyRound } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

const MIN_PASSWORD = 8;

/**
 * Rough strength score 0-4: length, case mix, digits, symbols.
 * Client-side guidance only — the server enforces the minimum.
 */
function scorePassword(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= MIN_PASSWORD) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score += 1;
  return score;
}

const STRENGTH_STYLE = [
  { width: 'w-0', color: '' },
  { width: 'w-1/4', color: 'bg-destructive' },
  { width: 'w-2/4', color: 'bg-amber-500' },
  { width: 'w-3/4', color: 'bg-amber-500' },
  { width: 'w-full', color: 'bg-emerald-500' },
] as const;

export function PasswordForm() {
  const t = useTranslations('Settings.profile');
  const ts = useTranslations('Settings.security');
  const { profile } = useAuth();
  const supabase = createClient();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const strength = useMemo(() => scorePassword(next), [next]);
  const strengthLabel = [
    '',
    ts('strengthWeak'),
    ts('strengthFair'),
    ts('strengthGood'),
    ts('strengthStrong'),
  ][strength];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.email) {
      toast.error(t('cannotChangeNoEmail'));
      return;
    }
    if (next.length < MIN_PASSWORD) {
      setConfirmError(t('passwordTooShort', { min: MIN_PASSWORD }));
      return;
    }
    if (next !== confirm) {
      setConfirmError(t('passwordMismatch'));
      return;
    }
    setConfirmError(null);
    setSaving(true);

    try {
      // Supabase doesn't expose a "verify password without issuing a
      // session" API, so we re-authenticate with the provided current
      // password. If it matches, the session refreshes silently; if it
      // doesn't, we abort before calling updateUser.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: current,
      });
      if (signInError) {
        toast.error(t('currentPasswordIncorrect'));
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: next,
      });
      if (updateError) {
        toast.error(
          t('passwordUpdateFailed', { message: updateError.message })
        );
        return;
      }

      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success(t('passwordUpdated'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <div className="flex flex-col gap-6 p-5 md:flex-row md:gap-10">
          {/* Left rail: what this section is and why it matters */}
          <div className="md:w-52 md:shrink-0">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                <KeyRound className="size-3.5" aria-hidden="true" />
              </span>
              <h3 className="text-foreground text-sm font-semibold">
                {t('passwordTitle')}
              </h3>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {t('passwordDesc', { min: MIN_PASSWORD })}
            </p>
          </div>

          {/* Right: the form itself */}
          <form
            onSubmit={onSubmit}
            className="flex min-w-0 flex-1 flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="current-password" className="text-foreground">
                {t('currentPassword')}
              </Label>
              <Input
                id="current-password"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                disabled={saving}
                required
                className="max-w-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password" className="text-foreground">
                  {t('newPassword')}
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD}
                  disabled={saving}
                  required
                />
                {next.length > 0 && (
                  <div aria-live="polite">
                    <div
                      className="bg-muted h-1 overflow-hidden rounded-full"
                      role="presentation"
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          STRENGTH_STYLE[strength].width,
                          STRENGTH_STYLE[strength].color
                        )}
                      />
                    </div>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      {strengthLabel}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password" className="text-foreground">
                  {t('confirmPassword')}
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD}
                  disabled={saving}
                  required
                />
              </div>
            </div>

            {confirmError && (
              <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
                {confirmError}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={saving || !current || !next || !confirm}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('updating')}
                  </>
                ) : (
                  t('updatePassword')
                )}
              </Button>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
