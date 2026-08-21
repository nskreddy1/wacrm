'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, ClipboardCheck, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StepFooter, StepHeading, SummaryGrid, SummaryItem, WizardPanel } from './wizard-ui';

/**
 * The audience shape is owned by step 2. This step used to redeclare a
 * loose local copy (`type: string` plus two fields), which is how the
 * review screen ended up unable to see `fieldFilter` or `contactIds`
 * and reported "0 recipients" for audiences that had plenty.
 */
import type { AudienceConfig } from './step2-select-audience';

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (
          audience.type === 'tags' &&
          audience.tagIds &&
          audience.tagIds.length > 0
        ) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set(
            (contactTags ?? []).map((ct) => ct.contact_id)
          );
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else if (audience.type === 'contacts' && audience.contactIds) {
          setEstimatedReach(new Set(audience.contactIds).size);
        } else if (audience.type === 'field' && audience.fieldFilter?.field) {
          // Field audiences used to fall through to the `else` and
          // review the campaign as "0 recipients" right before send.
          const { field, operator, value } = audience.fieldFilter;
          const trimmed = value.trim();
          let query = supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          if (operator === 'is') query = query.eq(field, trimmed);
          else if (operator === 'is_not') query = query.neq(field, trimmed);
          else query = query.ilike(field, `%${trimmed}%`);
          const { count } = await query;
          setEstimatedReach(count ?? 0);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : audience.type === 'contacts'
            ? t('scheduleSend.audienceContacts', {
                count: new Set(audience.contactIds ?? []).size,
              })
            : t('scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <StepHeading
        title={t('scheduleSend.title')}
        description={t('scheduleSend.subtitle')}
      />

      <WizardPanel
        icon={Tag}
        tone="accent"
        title={t('scheduleSend.broadcastName')}
        description={t('scheduleSend.broadcastNameDesc')}
      >
        <Input
          id="broadcast-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
        />
      </WizardPanel>

      <WizardPanel icon={ClipboardCheck} title={t('scheduleSend.summary')}>
        <SummaryGrid>
          <SummaryItem label={t('scheduleSend.template')}>
            {template.name}
          </SummaryItem>
          <SummaryItem label={t('scheduleSend.audience')}>
            {audienceLabel}
          </SummaryItem>
          <SummaryItem label={t('scheduleSend.estimatedReach')}>
            {loadingReach ? (
              <Loader2 className="text-primary size-3.5 animate-spin" />
            ) : (
              <span className="flex items-center gap-1.5">
                <Users className="text-primary size-3.5" />
                {estimatedReach.toLocaleString()}
              </span>
            )}
          </SummaryItem>
          <SummaryItem label={t('scheduleSend.language')}>
            {template.language ?? 'en_US'}
          </SummaryItem>
        </SummaryGrid>
      </WizardPanel>

      {isProcessing && (
        <WizardPanel
          icon={Loader2}
          tone="accent"
          title={t('scheduleSend.sending')}
          action={
            <span className="text-primary text-xs font-medium">
              {progress}%
            </span>
          }
        >
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </WizardPanel>
      )}

      <StepFooter
        backLabel={t('back')}
        onBack={onBack}
        backDisabled={isProcessing}
      >
        {onSaveDraft && (
          <Button
            variant="outline"
            onClick={onSaveDraft}
            disabled={!name.trim() || isProcessing}
          >
            <Save className="size-4" />
            {t('scheduleSend.saveDraft')}
          </Button>
        )}

        <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={<Button disabled={!name.trim() || isProcessing} />}
          >
            <Send className="size-4" />
            {t('scheduleSend.sendNow')}
          </DialogTrigger>
            <DialogContent className="border-border bg-popover sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">
                  Confirm Broadcast
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  You are about to send this broadcast to{' '}
                  <span className="text-popover-foreground font-medium">
                    {estimatedReach.toLocaleString()}
                  </span>{' '}
                  contacts using the{' '}
                  <span className="text-popover-foreground font-medium">
                    {template.name}
                  </span>{' '}
                  template. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="border-border text-muted-foreground"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSend();
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="h-4 w-4" />
                  {t('scheduleSend.sendNow')}
                </Button>
            
        </DialogFooter>
            </DialogContent>
          </Dialog>
      </StepFooter>
    </div>
  );
}
