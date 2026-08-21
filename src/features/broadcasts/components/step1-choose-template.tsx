'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { routes } from '@/lib/routing/routes';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { FileText, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Notice,
  OptionCard,
  OptionGrid,
  StepFooter,
  StepHeading,
  WizardPanel,
} from './wizard-ui';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Authentication: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

interface Step1Props {
  /**
   * Broadcast channel picked in the wizard header. Templates are
   * channel-specific (WhatsApp templates go through Meta review, SMS
   * templates are plain text, email templates carry a subject line),
   * so the list is scoped to this value.
   * Optional for backward compatibility — defaults to 'whatsapp'.
   */
  channel?: 'whatsapp' | 'sms' | 'email';
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({
  channel = 'whatsapp',
  selectedTemplate,
  onSelect,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchTemplates() {
      setLoading(true);
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent — WhatsApp drafts would
        // 400 at Meta, and SMS templates are marked APPROVED on save.
        // WhatsApp additionally matches NULL-channel rows saved before
        // the channel column existed (migration 047).
        let query = supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: false });
        query =
          channel === 'whatsapp'
            ? query.or('channel.eq.whatsapp,channel.is.null')
            : query.eq('channel', channel);
        const { data, error: fetchError } = await query;

        if (fetchError) throw fetchError;
        if (!cancelled) setTemplates(data ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : t('chooseTemplate.errorLoad')
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTemplates();
    return () => {
      cancelled = true;
    };
  }, [channel, t]);

  if (loading) {
    // Skeleton mirrors the real card grid so the layout doesn't jump
    // when templates arrive — a centered spinner collapsed the panel
    // height and shifted every control below it.
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="bg-muted h-6 w-48 animate-pulse rounded-md" />
          <div className="bg-muted/60 h-4 w-72 animate-pulse rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="border-border bg-card/50 h-32 animate-pulse rounded-xl border"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <StepHeading
          title={t('chooseTemplate.title')}
          description={t('chooseTemplate.subtitle')}
        />
        <Notice tone="error">{error}</Notice>
        <StepFooter
          backLabel={t('back')}
          onBack={onBack}
          showBackArrow={false}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeading
        title={t('chooseTemplate.title')}
        description={t('chooseTemplate.subtitle')}
      />

      {templates.length === 0 ? (
        <WizardPanel
          icon={FileText}
          title={t('chooseTemplate.noTemplates')}
          description={t('chooseTemplate.createFirst')}
        >
          {/* The old empty state was a dead end: it told the user to go
              to Settings but gave them no way to get there. */}
          <Button
            variant="outline"
            render={<Link href={routes.app.templates} />}
          >
            <Plus className="size-4" />
            {t('chooseTemplate.createTemplateAction')}
          </Button>
        </WizardPanel>
      ) : (
        <OptionGrid label={t('chooseTemplate.title')} columns={3}>
          {templates.map((template) => {
            const catColor =
              categoryColors[template.category] ?? categoryColors.Utility;

            return (
              <OptionCard
                key={template.id}
                label={template.name}
                description={template.body_text}
                selected={selectedTemplate?.id === template.id}
                onSelect={() => onSelect(template)}
                meta={
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                  >
                    {template.category}
                  </span>
                }
              />
            );
          })}
        </OptionGrid>
      )}

      <StepFooter
        backLabel={t('back')}
        onBack={onBack}
        showBackArrow={false}
        hint={
          !selectedTemplate && templates.length > 0
            ? t('chooseTemplate.selectToContinue')
            : null
        }
        nextLabel={t('next')}
        onNext={onNext}
        nextDisabled={!selectedTemplate}
      />
    </div>
  );
}
