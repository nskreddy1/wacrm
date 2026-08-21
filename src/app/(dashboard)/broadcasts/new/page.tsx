'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/features/broadcasts/components/step1-choose-template';
import { Step2SelectAudience } from '@/features/broadcasts/components/step2-select-audience';
import { Step3Personalize } from '@/features/broadcasts/components/step3-personalize';
import { Step4ScheduleSend } from '@/features/broadcasts/components/step4-schedule-send';
import { useBroadcastSending } from '@/features/broadcasts/hooks/use-broadcast-sending';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Save,
  Send,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

const steps = [
  { label: 'Template', description: 'Choose approved content', icon: FileText },
  { label: 'Audience', description: 'Define who receives it', icon: Users },
  {
    label: 'Personalize',
    description: 'Map message variables',
    icon: SlidersHorizontal,
  },
  {
    label: 'Review & send',
    description: 'Confirm final delivery',
    icon: Check,
  },
] as const;

type BroadcastChannel = 'whatsapp' | 'sms' | 'email';

const CHANNEL_META: Record<
  BroadcastChannel,
  { label: string; icon: typeof MessageCircle }
> = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  sms: { label: 'SMS', icon: MessageSquare },
  email: { label: 'Email', icon: Mail },
};

/** What a step reports back so the shared action bar can gate "Next". */
interface StepGate {
  ready: boolean;
  reason?: string;
}

export default function NewBroadcastPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.wizard');
  const { accountId } = useAuth();
  const { createAndSendBroadcast, isProcessing, progress } =
    useBroadcastSending();
  const [currentStep, setCurrentStep] = useState(0);
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [enabledChannels, setEnabledChannels] = useState<
    BroadcastChannel[] | null
  >(null);
  const [channel, setChannel] = useState<BroadcastChannel>('whatsapp');
  const [audience, setAudience] = useState<{
    type: 'all' | 'tags' | 'custom_field' | 'csv' | 'external';
    tagIds?: string[];
    customField?: {
      fieldId: string;
      operator: 'is' | 'is_not' | 'contains';
      value: string;
    };
    csvContacts?: { phone: string; name?: string }[];
    excludeTagIds?: string[];
    externalSourceId?: string;
    externalSourceName?: string;
    externalCount?: number;
    externalParamMap?: Record<string, string>;
  }>({ type: 'all' });
  const [variables, setVariables] = useState<
    Record<
      string,
      {
        type: 'static' | 'field' | 'custom_field' | 'external_param';
        value: string;
      }
    >
  >({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [name, setName] = useState('');
  // Gates published by the steps that own non-trivial validation.
  const [audienceGate, setAudienceGate] = useState<StepGate>({ ready: true });
  const [personalizeGate, setPersonalizeGate] = useState<StepGate>({
    ready: false,
  });
  // Single source of truth for reach: step 2 already resolves it exactly
  // (tags, custom fields, CSV, external sources, minus exclusions), so it
  // is lifted here instead of being re-derived — and wrongly — in step 4.
  const [estimatedReach, setEstimatedReach] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = new Set<BroadcastChannel>();
      try {
        const response = await fetch('/api/settings/channels');
        if (response.ok) {
          const payload: {
            connections?: Array<{ channel: string; is_enabled: boolean }>;
          } = await response.json();
          for (const connection of payload.connections ?? []) {
            if (
              connection.is_enabled &&
              (connection.channel === 'whatsapp' ||
                connection.channel === 'sms' ||
                connection.channel === 'email')
            )
              found.add(connection.channel);
          }
        }
      } catch (error) {
        // Non-fatal: fall through to the direct whatsapp_config check below.
        console.warn('channel connections fetch failed, using fallback', error);
      }
      if (!found.has('whatsapp')) {
        const supabase = createClient();
        const { data } = await supabase
          .from('whatsapp_config')
          .select('status')
          .maybeSingle();
        if (data?.status === 'connected') found.add('whatsapp');
      }
      // Email can also ride the platform sender (Resend/Mailtrap env
      // keys) with no workspace connection row — the broadcast API's
      // GET reports effective availability either way.
      if (!found.has('email')) {
        try {
          const res = await fetch('/api/email/broadcast');
          if (res.ok) {
            const data: { available?: boolean } = await res.json();
            if (data.available) found.add('email');
          }
        } catch {
          // Non-fatal: email simply isn't offered this session.
        }
      }
      if (cancelled) return;
      const channels = (['whatsapp', 'sms', 'email'] as const).filter(
        (value) => found.has(value)
      );
      setEnabledChannels(channels);
      if (channels.length === 1) setChannel(channels[0]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChannelChange(next: BroadcastChannel) {
    if (next === channel) return;
    setChannel(next);
    setTemplate(null);
    setVariables({});
    setHeaderMediaUrl('');
    setCurrentStep(0);
  }

  async function handleSend() {
    if (!template) return;
    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        template,
        channel,
        audience,
        variables,
        headerMediaUrl,
      });
      router.push(`/broadcasts/${broadcastId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Broadcast failed');
    }
  }

  async function handleSaveDraft() {
    if (!template || !name.trim()) {
      toast.error('Give this broadcast a name before saving.');
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user || !accountId) {
      toast.error('Your profile is not linked to an account.');
      return;
    }
    const { error } = await supabase.from('broadcasts').insert({
      user_id: session.user.id,
      account_id: accountId,
      name: name.trim(),
      channel,
      template_name: template.name,
      template_language: template.language ?? 'en_US',
      template_variables: variables,
      audience_filter: { type: audience.type, tagIds: audience.tagIds },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });
    if (error) {
      toast.error(`Could not save draft: ${error.message}`);
      return;
    }
    toast.success('Draft saved');
    router.push('/broadcasts');
  }

  const stepContent = [
    <Step1ChooseTemplate
      key="template"
      channel={channel}
      selectedTemplate={template}
      onSelect={setTemplate}
    />,
    <Step2SelectAudience
      key="audience"
      audience={audience}
      onUpdate={setAudience}
      onGateChange={setAudienceGate}
      onEstimateChange={setEstimatedReach}
    />,
    template ? (
      <Step3Personalize
        key="personalize"
        channel={channel}
        template={template}
        variables={variables}
        onUpdate={setVariables}
        headerMediaUrl={headerMediaUrl}
        onHeaderMediaUrlChange={setHeaderMediaUrl}
        externalParamMap={
          audience.type === 'external' ? audience.externalParamMap : undefined
        }
        onNext={() => {
          setPersonalizeGate({ ready: true });
          setCurrentStep(3);
        }}
        onBack={() => setCurrentStep(1)}
      />
    ) : null,
    template ? (
      <Step4ScheduleSend
        key="send"
        name={name}
        onNameChange={setName}
        template={template}
        audience={audience}
        onSend={handleSend}
        onSaveDraft={handleSaveDraft}
        onBack={() => setCurrentStep(2)}
        isProcessing={isProcessing}
        progress={progress}
      />
    ) : null,
  ];

  // One place decides what the footer does on each step, so the primary
  // action can live in a bar that is pinned and always reachable.
  const gate: StepGate =
    currentStep === 0
      ? {
          ready: Boolean(template),
          reason: template ? undefined : t('chooseTemplate.selectToContinue'),
        }
      : currentStep === 1
        ? audienceGate
        : currentStep === 2
          ? personalizeGate
          : {
              ready: Boolean(name.trim()) && !isProcessing,
              reason: name.trim() ? undefined : t('actions.nameRequired'),
            };

  const isLastStep = currentStep === steps.length - 1;

  return (
    // Plain <div>: the dashboard shell already provides <main>. h-full +
    // min-h-0 hands the scroll to the content column below, so the action
    // bar stays on screen at any zoom level instead of being clipped by
    // the shell's overflow-hidden wrapper.
    <div className="bg-muted/20 flex h-full min-h-0 flex-col">
      <header className="border-border bg-background shrink-0 border-b">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/broadcasts')}
              aria-label="Back to broadcasts"
            >
              <ArrowLeft />
            </Button>
            <div className="min-w-0">
              <h1 className="text-foreground truncate text-base font-semibold">
                Create broadcast
              </h1>
            </div>
          </div>
          <Badge variant="outline">
            Draft · Step {currentStep + 1} of {steps.length}
          </Badge>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-border bg-card shrink-0 border-b px-4 py-3 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-4 lg:py-5">
          <ol className="flex gap-1 lg:flex-col">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const completed = index < currentStep;
              const active = index === currentStep;
              return (
                <li
                  key={step.label}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2',
                    active && 'bg-primary/10'
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                      completed &&
                        'border-primary bg-primary text-primary-foreground',
                      active && !completed && 'border-primary text-primary',
                      !active &&
                        !completed &&
                        'border-border text-muted-foreground'
                    )}
                  >
                    {completed ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Icon className="size-3.5" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'hidden truncate text-sm font-medium lg:block',
                      active || completed
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="border-border mt-3 border-t pt-3 lg:mt-5 lg:pt-5">
            <p className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
              Delivery channel
            </p>
            {enabledChannels === null ? (
              <div className="bg-muted h-9 animate-pulse rounded-lg" />
            ) : enabledChannels.length === 0 ? (
              <p className="text-destructive text-xs leading-5">
                Connect WhatsApp, SMS, or Email in Settings before creating a
                broadcast.
              </p>
            ) : (
              // Horizontal on small screens, stacked on desktop — the old
              // layout hid the selector below lg, so phone users were
              // silently locked to WhatsApp.
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {enabledChannels.map((value) => {
                  const { label, icon: Icon } = CHANNEL_META[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleChannelChange(value)}
                      aria-pressed={channel === value}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors duration-150',
                        channel === value
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="border-border bg-card mx-auto max-w-4xl rounded-xl border p-5 shadow-sm sm:p-6">
              <div
                className={cn(
                  'transition-opacity duration-150',
                  isProcessing && 'pointer-events-none opacity-60'
                )}
              >
                {stepContent[currentStep]}
              </div>
            </div>
          </div>

          {/* Pinned action bar: the wizard's primary action never scrolls
              out of reach, and the reach estimate travels with it so the
              consequence of "Send" is visible at the moment of the click. */}
          <div className="border-border bg-background/95 shrink-0 border-t backdrop-blur">
            <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    currentStep === 0
                      ? router.push('/broadcasts')
                      : setCurrentStep(currentStep - 1)
                  }
                  disabled={isProcessing}
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('back')}
                </Button>
                <p className="text-muted-foreground min-w-0 truncate text-xs">
                  {gate.ready
                    ? estimatedReach === null
                      ? CHANNEL_META[channel].label
                      : `${estimatedReach.toLocaleString()} ${t('actions.recipients')} · ${CHANNEL_META[channel].label}`
                    : gate.reason}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isLastStep && (
                  <Button
                    variant="outline"
                    onClick={handleSaveDraft}
                    disabled={!name.trim() || isProcessing}
                  >
                    <Save className="h-4 w-4" />
                    {t('scheduleSend.saveDraft')}
                  </Button>
                )}
                <Button
                  onClick={() =>
                    isLastStep
                      ? setShowConfirm(true)
                      : setCurrentStep(currentStep + 1)
                  }
                  disabled={!gate.ready || isProcessing}
                >
                  {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isLastStep ? t('scheduleSend.sendNow') : t('next')}
                  {isLastStep ? (
                    <Send className="h-4 w-4" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Confirm broadcast
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              You are about to send this broadcast to{' '}
              <span className="text-popover-foreground font-medium">
                {(estimatedReach ?? 0).toLocaleString()}
              </span>{' '}
              contacts over {CHANNEL_META[channel].label} using the{' '}
              <span className="text-popover-foreground font-medium">
                {template?.name}
              </span>{' '}
              template. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                setShowConfirm(false);
                void handleSend();
              }}
            >
              <Send className="h-4 w-4" />
              {t('scheduleSend.sendNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
