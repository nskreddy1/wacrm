'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/components/broadcasts/step1-choose-template';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3Personalize } from '@/components/broadcasts/step3-personalize';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, FileText, MessageCircle, MessageSquare, SlidersHorizontal, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const steps = [
  { label: 'Template', description: 'Choose approved content', icon: FileText },
  { label: 'Audience', description: 'Define who receives it', icon: Users },
  { label: 'Personalize', description: 'Map message variables', icon: SlidersHorizontal },
  { label: 'Review & send', description: 'Confirm final delivery', icon: Check },
] as const;

type BroadcastChannel = 'whatsapp' | 'sms';

export default function NewBroadcastPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const { createAndSendBroadcast, isProcessing, progress } = useBroadcastSending();
  const [currentStep, setCurrentStep] = useState(0);
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [enabledChannels, setEnabledChannels] = useState<BroadcastChannel[] | null>(null);
  const [channel, setChannel] = useState<BroadcastChannel>('whatsapp');
  const [audience, setAudience] = useState<{
    type: 'all' | 'tags' | 'custom_field' | 'csv';
    tagIds?: string[];
    customField?: { fieldId: string; operator: 'is' | 'is_not' | 'contains'; value: string };
    csvContacts?: { phone: string; name?: string }[];
    excludeTagIds?: string[];
  }>({ type: 'all' });
  const [variables, setVariables] = useState<Record<string, { type: 'static' | 'field' | 'custom_field'; value: string }>>({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = new Set<BroadcastChannel>();
      try {
        const response = await fetch('/api/settings/channels');
        if (response.ok) {
          const payload: { connections?: Array<{ channel: string; is_enabled: boolean }> } = await response.json();
          for (const connection of payload.connections ?? []) {
            if (connection.is_enabled && (connection.channel === 'whatsapp' || connection.channel === 'sms')) found.add(connection.channel);
          }
        }
      } catch {}
      if (!found.has('whatsapp')) {
        const supabase = createClient();
        const { data } = await supabase.from('whatsapp_config').select('status').maybeSingle();
        if (data?.status === 'connected') found.add('whatsapp');
      }
      if (cancelled) return;
      const channels = (['whatsapp', 'sms'] as const).filter((value) => found.has(value));
      setEnabledChannels(channels);
      if (channels.length === 1) setChannel(channels[0]);
    })();
    return () => { cancelled = true; };
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
      const broadcastId = await createAndSendBroadcast({ name, template, channel, audience, variables, headerMediaUrl });
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
    const { data: { session } } = await supabase.auth.getSession();
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
    <Step1ChooseTemplate key="template" channel={channel} selectedTemplate={template} onSelect={setTemplate} onNext={() => setCurrentStep(1)} onBack={() => router.push('/broadcasts')} />,
    <Step2SelectAudience key="audience" audience={audience} onUpdate={setAudience} onNext={() => setCurrentStep(2)} onBack={() => setCurrentStep(0)} />,
    template ? <Step3Personalize key="personalize" channel={channel} template={template} variables={variables} onUpdate={setVariables} headerMediaUrl={headerMediaUrl} onHeaderMediaUrlChange={setHeaderMediaUrl} onNext={() => setCurrentStep(3)} onBack={() => setCurrentStep(1)} /> : null,
    template ? <Step4ScheduleSend key="send" name={name} onNameChange={setName} template={template} audience={audience} onSend={handleSend} onSaveDraft={handleSaveDraft} onBack={() => setCurrentStep(2)} isProcessing={isProcessing} progress={progress} /> : null,
  ];

  return (
    <main className="min-h-full bg-muted/20">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/broadcasts')} aria-label="Back to broadcasts"><ArrowLeft /></Button>
            <div className="min-w-0"><h1 className="truncate text-lg font-semibold text-foreground">Create broadcast</h1><p className="hidden text-xs text-muted-foreground sm:block">Build a targeted campaign with confidence.</p></div>
          </div>
          <Badge variant="outline">Draft · Step {currentStep + 1} of {steps.length}</Badge>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-card p-4 lg:min-h-[calc(100vh-73px)] lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex gap-2 lg:flex-col">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const completed = index < currentStep;
              const active = index === currentStep;
              return (
                <div key={step.label} className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5', active && 'bg-primary/10')} aria-current={active ? 'step' : undefined}>
                  <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium', completed && 'border-primary bg-primary text-primary-foreground', active && !completed && 'border-primary text-primary', !active && !completed && 'border-border text-muted-foreground')}>
                    {completed ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </div>
                  <div className="hidden min-w-0 lg:block"><p className={cn('text-sm font-medium', active || completed ? 'text-foreground' : 'text-muted-foreground')}>{step.label}</p><p className="truncate text-xs text-muted-foreground">{step.description}</p></div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 hidden border-t border-border pt-6 lg:block">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Delivery channel</p>
            {enabledChannels === null ? <div className="h-20 animate-pulse rounded-lg bg-muted" /> : enabledChannels.length === 0 ? <p className="text-xs leading-5 text-destructive">Connect WhatsApp or SMS in Settings before creating a broadcast.</p> : (
              <div className="flex flex-col gap-2">
                {enabledChannels.map((value) => {
                  const Icon = value === 'whatsapp' ? MessageCircle : MessageSquare;
                  return <button key={value} type="button" onClick={() => handleChannelChange(value)} className={cn('flex items-center gap-3 rounded-lg border p-3 text-left text-sm font-medium transition-colors duration-150', channel === value ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}><Icon className="size-4" />{value === 'whatsapp' ? 'WhatsApp' : 'SMS'}</button>;
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-4xl rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7 lg:p-8">
            <div className={cn('transition-opacity duration-150', isProcessing && 'pointer-events-none opacity-60')}>
              {stepContent[currentStep]}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
