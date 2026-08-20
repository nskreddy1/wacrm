'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
  X,
} from 'lucide-react';
import {
  extractTemplateVariables,
  renderTemplateText,
  toPositionalValues,
  type TemplateVariable,
} from '@/features/whatsapp/lib/template-variables';
import { useTranslations } from 'next-intl';

export interface TemplateSendValues {
  /**
   * Body values in positional order — what Meta components and Twilio
   * positional `ContentVariables` consume.
   */
  body: string[];
  /**
   * The same values keyed by raw token (`"1"`, `"first_name"`). Named
   * templates need this: Twilio maps `ContentVariables` by key and our
   * SMS renderer substitutes by key, neither of which can be recovered
   * from a positional array.
   */
  variables: Record<string, string>;
  headerText?: string;
  buttonParams?: Record<number, string>;
}

/** Server-computed sendability for this conversation's channel+provider. */
type TemplateSendMode = 'twilio_content' | 'meta_components' | 'text';

type SendableTemplate = MessageTemplate & { send_mode: TemplateSendMode };

interface TemplatePickerProps {
  /** Scopes the fetch — sendability depends on THIS conversation. */
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Every value the send path can demand: body variables (positional or
 * named), a text-header variable, and per-URL-button suffixes. Collected
 * together so a send never 400s on a parameter the agent was never asked
 * for.
 */
function collectSlots(template: MessageTemplate): {
  bodyVars: TemplateVariable[];
  headerVars: TemplateVariable[];
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractTemplateVariables(template.body_text);
  const headerVars =
    template.header_type === 'text'
      ? extractTemplateVariables(template.header_content)
      : [];
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === 'URL' && extractTemplateVariables(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVars, urlButtonSlots };
}

export function TemplatePicker({
  conversationId,
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const t = useTranslations('Inbox.templatePicker');

  const [templates, setTemplates] = useState<SendableTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SendableTemplate | null>(null);
  /** Body values keyed by raw token, so named and positional share one map. */
  const [values, setValues] = useState<Record<string, string>>({});
  const [headerText, setHeaderText] = useState('');
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});

  const resetSelection = useCallback(() => {
    setSelected(null);
    setValues({});
    setHeaderText('');
    setButtonParams({});
  }, []);

  const close = useCallback(() => {
    resetSelection();
    onOpenChange(false);
  }, [resetSelection, onOpenChange]);

  // Sendability is per-conversation, so the list is refetched whenever the
  // panel opens or the agent switches contact. Reading `message_templates`
  // straight from the browser (the old behaviour) could not know the
  // channel or the wired provider, which is how SMS rows ended up offered
  // inside WhatsApp threads and failed at the provider.
  useEffect(() => {
    if (!open || !conversationId) return;

    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/inbox/templates?conversation_id=${encodeURIComponent(conversationId)}`,
          { signal: controller.signal }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setTemplates([]);
          setLoadError(data.error ?? t('loadFailed'));
          return;
        }
        setTemplates((data.templates as SendableTemplate[]) ?? []);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setTemplates([]);
        setLoadError(t('loadFailed'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [open, conversationId, t]);

  // Switching contact while the panel is open must not carry the previous
  // thread's half-filled template into the new one. Adjusted during render
  // (the React-documented pattern) so the new thread never paints the old
  // thread's selection for a frame, and so no cascading effect render is
  // queued. The parent also keys this component by conversation — this is
  // the belt to that braces, and it keeps the guarantee local.
  const [prevConversationId, setPrevConversationId] = useState(conversationId);
  if (prevConversationId !== conversationId) {
    setPrevConversationId(conversationId);
    resetSelection();
  }

  const slots = useMemo(
    () => (selected ? collectSlots(selected) : null),
    [selected]
  );

  function pickTemplate(template: SendableTemplate) {
    const next = collectSlots(template);
    const needsNothing =
      next.bodyVars.length === 0 &&
      next.headerVars.length === 0 &&
      next.urlButtonSlots.length === 0;
    if (needsNothing) {
      onSelect(template, { body: [], variables: {} });
      close();
      return;
    }
    setSelected(template);
    setValues({});
    setHeaderText('');
    setButtonParams({});
  }

  function confirm() {
    if (!selected || !slots) return;
    const payload: TemplateSendValues = {
      body: toPositionalValues(selected.body_text, values),
      variables: values,
    };
    if (headerText.trim()) payload.headerText = headerText.trim();
    if (Object.keys(buttonParams).length > 0) {
      payload.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()])
      );
    }
    onSelect(selected, payload);
    close();
  }

  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((v) => (values[v.token] ?? '').trim().length > 0) &&
    (slots.headerVars.length === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? '').trim().length > 0
    );

  if (!open) return null;

  return (
    // In-flow panel, not a dialog: it sits directly above the composer so
    // the agent keeps the thread in view while choosing. A modal here hid
    // the very conversation the template is addressed to, and its scrim
    // broke the flow for what is a parallel, non-destructive task.
    <section
      aria-label={t('sendTemplate')}
      className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 animate-in slide-in-from-bottom-2 fade-in overflow-hidden border-t backdrop-blur-xl duration-200 motion-reduce:animate-none"
    >
      <header className="border-border/60 flex items-center gap-2 border-b px-4 py-2.5">
        {selected && (
          <button
            type="button"
            onClick={resetSelection}
            aria-label={t('back')}
            className="text-muted-foreground hover:text-foreground -ml-1 rounded p-1 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <LayoutTemplate className="text-primary h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-medium">
            {selected ? selected.name : t('sendTemplate')}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {selected ? t('fillPlaceholders') : t('pickTemplate')}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={t('cancel')}
          className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {!selected ? (
        <div className="max-h-64 space-y-1.5 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="text-primary h-5 w-5 animate-spin" />
            </div>
          ) : loadError ? (
            <p className="text-destructive px-1 py-4 text-center text-sm">
              {loadError}
            </p>
          ) : templates.length === 0 ? (
            <div className="px-1 py-4 text-center">
              <p className="text-foreground text-sm">
                {t('noApprovedTemplates')}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('noSendableHint')}
              </p>
            </div>
          ) : (
            templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => pickTemplate(tpl)}
                className="border-border/60 bg-background/40 hover:border-primary/40 hover:bg-background w-full rounded-lg border p-2.5 text-left transition-colors"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-foreground truncate text-sm font-medium">
                        {tpl.name}
                      </p>
                      <Badge className="border-primary/30 bg-primary/15 text-primary border text-[10px]">
                        {tpl.category}
                      </Badge>
                      {tpl.language && (
                        <span className="text-muted-foreground text-[10px] uppercase">
                          {tpl.language}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {tpl.body_text}
                    </p>
                  </div>
                  <ChevronRight className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto p-3">
          <div className="border-border/60 bg-background/40 rounded-lg border p-2.5">
            <p className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
              {t('preview')}
            </p>
            <p className="text-foreground text-sm whitespace-pre-wrap">
              {renderTemplateText(selected.body_text, values)}
            </p>
            {selected.footer_text && (
              <p className="text-muted-foreground mt-1.5 text-xs italic">
                {selected.footer_text}
              </p>
            )}
          </div>

          {slots?.headerVars.length ? (
            <div className="space-y-1">
              <Label className="text-foreground text-xs">
                {t('headerLabel', { name: slots.headerVars[0].label })}
              </Label>
              <Input
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder={t('headerValuePlaceholder')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground h-9"
              />
            </div>
          ) : null}

          {slots?.bodyVars.map((v) => (
            <div key={v.token} className="space-y-1">
              <Label className="text-foreground text-xs">{v.label}</Label>
              <Input
                value={values[v.token] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [v.token]: e.target.value }))
                }
                placeholder={t('bodyValuePlaceholder', { val: v.label })}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground h-9"
              />
            </div>
          ))}

          {slots?.urlButtonSlots.map((slot) => (
            <div key={slot.index} className="space-y-1">
              <Label className="text-foreground text-xs">
                {t('urlButtonLabel', { text: slot.text })}
              </Label>
              <Input
                value={buttonParams[slot.index] ?? ''}
                onChange={(e) =>
                  setButtonParams((prev) => ({
                    ...prev,
                    [slot.index]: e.target.value,
                  }))
                }
                placeholder={t('urlSuffixValuePlaceholder')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground h-9"
              />
              <p className="text-muted-foreground text-[10px] break-all">
                {t('finalUrl', {
                  url: renderTemplateText(slot.url, {
                    ...values,
                    ...(buttonParams[slot.index]
                      ? { '1': buttonParams[slot.index] }
                      : {}),
                  }),
                })}
              </p>
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={resetSelection}
              className="border-border text-foreground hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('back')}
            </Button>
            <Button
              size="sm"
              disabled={!canConfirm}
              onClick={confirm}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t('send')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
