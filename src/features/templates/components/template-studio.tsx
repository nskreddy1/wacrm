'use client';

// ============================================================
// TemplateStudio — the template lab.
//
// Three panes:
//   1. Template rail — templates from /api/templates, channel-tagged.
//   2. Editor — channel-aware: WhatsApp structured blocks (header /
//      body / footer / draggable buttons) or SMS with live GSM-7 vs
//      Unicode segment math.
//   3. Live preview — iPhone / Android device frames.
//
// Persistence + provider submission (Meta / Twilio) live in
// hooks/use-studio-templates.ts. Unsaved edits are kept locally
// and merged over server rows until saved.
// ============================================================

import { useMemo, useState } from 'react';

import {
  GripVertical,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquareText,
  Phone,
  Plus,
  Reply,
  RefreshCw,
  Smartphone,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStudioTemplates } from '@/features/templates/hooks/use-studio-templates';
import {
  normalizeVariableKey,
  useTemplateVariables,
} from '@/features/templates/hooks/use-template-variables';
import { checkCompliance } from '@/features/templates/lib/compliance';
import { cn } from '@/lib/utils';
import {
  analyzeSms,
  CATEGORY_LABELS,
  STATUS_META,
  TEMPLATE_VARIABLES,
  type HeaderKind,
  type StudioTemplate,
  type TemplateButton,
  type TemplateChannel,
} from '@/features/templates/lib/studio-types';

import { PhonePreview, type DeviceKind } from './phone-preview';

const WA_BODY_LIMIT = 1024;
const WA_HEADER_LIMIT = 60;
const WA_FOOTER_LIMIT = 60;
const WA_BUTTON_LIMIT = 3;

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Studio category → SMS compliance category (mirrors the hook's DB mapping). */
const SMS_CATEGORY_FOR_CHECK: Record<
  StudioTemplate['category'],
  'marketing' | 'transactional' | 'otp'
> = {
  marketing: 'marketing',
  utility: 'transactional',
  authentication: 'otp',
};

function blankTemplate(): StudioTemplate {
  return {
    id: nextId('tpl-new'),
    name: 'Untitled template',
    channel: 'whatsapp',
    category: 'utility',
    language: 'en_US',
    status: 'draft',
    provider: 'meta',
    updatedAt: new Date().toISOString().slice(0, 10),
    whatsapp: {
      headerKind: 'none',
      headerText: '',
      body: '',
      footer: '',
      buttons: [],
    },
    sms: { body: '' },
    isNew: true,
  };
}

// ------------------------------------------------------------
// Template rail
// ------------------------------------------------------------

function TemplateRail({
  templates,
  activeId,
  isLoading,
  onSelect,
  onCreate,
  onSync,
  isSyncing,
}: {
  templates: StudioTemplate[];
  activeId: string;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSync: () => void;
  isSyncing: boolean;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-60 xl:w-64">
      <Button onClick={onCreate} className="w-full justify-center gap-2">
        <Plus className="size-4" aria-hidden="true" /> New template
      </Button>
      <Button
        variant="outline"
        onClick={onSync}
        disabled={isSyncing}
        className="w-full justify-center gap-2"
        title="Import approved WhatsApp templates from Twilio or Meta and refresh statuses"
      >
        {isSyncing ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-4" aria-hidden="true" />
        )}
        Sync templates
      </Button>
      {isLoading && templates.length === 0 && (
        <div className="flex flex-col gap-1.5" aria-label="Loading templates">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="border-border bg-card h-16 animate-pulse rounded-lg border"
            />
          ))}
        </div>
      )}
      {!isLoading && templates.length === 0 && (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs leading-relaxed">
          No templates yet. Create your first WhatsApp or SMS template to get
          started.
        </p>
      )}
      <div className="flex flex-col gap-1.5 overflow-y-auto">
        {templates.map((tpl) => {
          const meta = STATUS_META[tpl.status];
          const active = tpl.id === activeId;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onSelect(tpl.id)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'group rounded-lg border p-3 text-left transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/25 hover:bg-accent/50'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground truncate text-sm font-medium">
                  {tpl.name}
                </span>
                <Badge
                  variant="secondary"
                  className={cn('shrink-0 text-[10px]', meta.className)}
                >
                  {meta.label}
                </Badge>
              </div>
              <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                <span className="uppercase">
                  {tpl.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{CATEGORY_LABELS[tpl.category]}</span>
                <span aria-hidden="true">·</span>
                <span>{tpl.language}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------
// Variable chips
// ------------------------------------------------------------

function VariableChips({ onInsert }: { onInsert: (token: string) => void }) {
  const {
    variables: customVariables,
    createVariable,
    deleteVariable,
  } = useTemplateVariables();
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [newSample, setNewSample] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  function resetForm() {
    setIsAdding(false);
    setNewLabel('');
    setNewKey('');
    setKeyEdited(false);
    setNewSample('');
  }

  async function handleCreate() {
    const key = normalizeVariableKey(keyEdited ? newKey : newLabel);
    if (!key) {
      toast.error('Give the variable a name first');
      return;
    }
    setIsSaving(true);
    const result = await createVariable({
      key,
      label: newLabel.trim() || key,
      sampleValue: newSample,
    });
    setIsSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`{{${key}}} added to your variable library`);
    onInsert(`{{${key}}}`);
    resetForm();
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5" aria-label="Insert a variable">
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() => onInsert(v.token)}
            title={`${v.token} — previews as "${v.sample}"`}
            className="group border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-0.5 text-[11px] transition-colors"
          >
            <span className="font-medium">{v.label}</span>
            <span className="text-primary/60 group-hover:text-primary/80 font-mono text-[10px]">
              {v.token}
            </span>
          </button>
        ))}
        {/* Account-defined variables — deletable, teal accent to
            distinguish from the built-in set. */}
        {customVariables.map((v) => (
          <span
            key={v.id}
            className="group flex items-center overflow-hidden rounded-md border border-dashed border-teal-600/40 bg-teal-500/5 text-[11px] text-teal-700 dark:text-teal-400"
          >
            <button
              type="button"
              onClick={() => onInsert(`{{${v.key}}}`)}
              title={`{{${v.key}}} — previews as "${v.sampleValue || v.label}"`}
              className="flex items-center gap-1.5 px-2 py-0.5 transition-colors hover:bg-teal-500/10"
            >
              <span className="font-medium">{v.label}</span>
              <span className="font-mono text-[10px] opacity-60 group-hover:opacity-90">
                {`{{${v.key}}}`}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Delete variable ${v.label}`}
              onClick={async () => {
                const result = await deleteVariable(v.id);
                if (!result.ok) toast.error(result.error);
              }}
              className="hover:bg-destructive/10 hover:text-destructive border-l border-dashed border-teal-600/40 px-1 py-0.5 opacity-50 transition-opacity hover:opacity-100"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setIsAdding((v) => !v)}
          aria-expanded={isAdding}
          className="border-border text-muted-foreground hover:border-primary/40 hover:text-primary flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] font-medium transition-colors"
        >
          <Plus className="size-3" aria-hidden="true" /> Add variable
        </button>
      </div>

      {/* Inline creator — label + key + sample value. The key is
          auto-derived from the label until the member edits it. */}
      {isAdding && (
        <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="new-var-label"
                className="text-muted-foreground text-[11px]"
              >
                Name
              </Label>
              <Input
                id="new-var-label"
                value={newLabel}
                placeholder="Student name"
                className="h-8 text-xs"
                onChange={(e) => {
                  setNewLabel(e.target.value);
                  if (!keyEdited)
                    setNewKey(normalizeVariableKey(e.target.value));
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="new-var-key"
                className="text-muted-foreground text-[11px]"
              >
                Key
              </Label>
              <Input
                id="new-var-key"
                value={newKey}
                placeholder="student_name"
                className="h-8 font-mono text-xs"
                onChange={(e) => {
                  setKeyEdited(true);
                  setNewKey(normalizeVariableKey(e.target.value));
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="new-var-sample"
                className="text-muted-foreground text-[11px]"
              >
                Sample value <span className="opacity-60">(for preview)</span>
              </Label>
              <Input
                id="new-var-sample"
                value={newSample}
                placeholder="Aarav Kumar"
                className="h-8 text-xs"
                onChange={(e) => setNewSample(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground font-mono text-[11px]">
              {newKey
                ? `Inserts as {{${newKey}}}`
                : 'Key auto-fills from the name'}
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={resetForm}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={isSaving}
                onClick={handleCreate}
              >
                {isSaving ? 'Saving…' : 'Save & insert'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <p className="text-muted-foreground text-[11px] leading-relaxed">
        Click to insert. The preview fills variables with sample data — real
        contact values are mapped when you send a broadcast.
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// WhatsApp button list — drag to reorder
// ------------------------------------------------------------

function ButtonRow({
  button,
  index,
  onChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  isDragTarget,
}: {
  button: TemplateButton;
  index: number;
  onChange: (updated: TemplateButton) => void;
  onRemove: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number, e: React.DragEvent) => void;
  onDrop: () => void;
  isDragTarget: boolean;
}) {
  const KindIcon =
    button.kind === 'url' ? Link2 : button.kind === 'call' ? Phone : Reply;
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(index, e)}
      onDrop={onDrop}
      className={cn(
        'bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2 transition-all',
        isDragTarget
          ? 'border-primary/60 ring-primary/30 ring-1'
          : 'border-border'
      )}
    >
      <span
        className="text-muted-foreground cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </span>
      <KindIcon className="text-primary size-4 shrink-0" aria-hidden="true" />
      <Input
        value={button.label}
        maxLength={25}
        placeholder="Button label"
        onChange={(e) => onChange({ ...button, label: e.target.value })}
        className="h-8 w-32 flex-1 text-sm"
      />
      {button.kind === 'url' && (
        <Input
          value={button.url}
          placeholder="https://…"
          onChange={(e) => onChange({ ...button, url: e.target.value })}
          className="h-8 w-40 flex-1 text-sm"
        />
      )}
      {button.kind === 'call' && (
        <Input
          value={button.phone}
          placeholder="+1 555 000 1234"
          onChange={(e) => onChange({ ...button, phone: e.target.value })}
          className="h-8 w-36 flex-1 text-sm"
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={`Remove ${button.label || 'button'}`}
        className="text-muted-foreground hover:text-destructive size-8"
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ------------------------------------------------------------
// Editors
// ------------------------------------------------------------

function WhatsAppEditor({
  template,
  onPatch,
}: {
  template: StudioTemplate;
  onPatch: (patch: Partial<StudioTemplate['whatsapp']>) => void;
}) {
  const wa = template.whatsapp;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const insertVariable = (token: string) =>
    onPatch({
      body: `${wa.body}${wa.body && !wa.body.endsWith(' ') ? ' ' : ''}${token}`,
    });

  const addButton = (kind: TemplateButton['kind']) => {
    if (wa.buttons.length >= WA_BUTTON_LIMIT) return;
    const base = { id: nextId('btn'), label: '' };
    const btn: TemplateButton =
      kind === 'url'
        ? { ...base, kind, url: '' }
        : kind === 'call'
          ? { ...base, kind, phone: '' }
          : { ...base, kind: 'quick_reply' };
    onPatch({ buttons: [...wa.buttons, btn] });
  };

  const reorder = () => {
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...wa.buttons];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(overIndex, 0, moved);
    onPatch({ buttons: next });
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header block */}
      <section
        aria-labelledby="wa-header-label"
        className="flex flex-col gap-2"
      >
        <div className="flex items-center justify-between">
          <Label
            id="wa-header-label"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Header
          </Label>
          <Tabs
            value={wa.headerKind}
            onValueChange={(v) => onPatch({ headerKind: v as HeaderKind })}
          >
            <TabsList className="h-8">
              <TabsTrigger value="none" className="gap-1 px-2.5 text-xs">
                None
              </TabsTrigger>
              <TabsTrigger value="text" className="gap-1 px-2.5 text-xs">
                <Type className="size-3.5" aria-hidden="true" /> Text
              </TabsTrigger>
              <TabsTrigger value="image" className="gap-1 px-2.5 text-xs">
                <ImageIcon className="size-3.5" aria-hidden="true" /> Image
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {wa.headerKind === 'text' && (
          <div>
            <Input
              value={wa.headerText}
              maxLength={WA_HEADER_LIMIT}
              placeholder="A short, bold opening line"
              onChange={(e) => onPatch({ headerText: e.target.value })}
            />
            <p className="text-muted-foreground mt-1 text-right text-[11px] tabular-nums">
              {wa.headerText.length}/{WA_HEADER_LIMIT}
            </p>
          </div>
        )}
        {wa.headerKind === 'image' && (
          <div className="border-border bg-muted/40 text-muted-foreground flex aspect-[3/1] items-center justify-center rounded-lg border border-dashed text-sm">
            Image placeholder — media upload arrives with the integration
          </div>
        )}
      </section>

      {/* Body block */}
      <section aria-labelledby="wa-body-label" className="flex flex-col gap-2">
        <Label
          id="wa-body-label"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Body
        </Label>
        <Textarea
          value={wa.body}
          maxLength={WA_BODY_LIMIT}
          rows={6}
          placeholder={
            'Write your message. Insert variables like {{first_name}} below.'
          }
          onChange={(e) => onPatch({ body: e.target.value })}
          className="resize-y font-sans text-sm leading-relaxed"
        />
        <div className="flex items-start justify-between gap-3">
          <VariableChips onInsert={insertVariable} />
          <p className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {wa.body.length}/{WA_BODY_LIMIT}
          </p>
        </div>
      </section>

      {/* Footer block */}
      <section
        aria-labelledby="wa-footer-label"
        className="flex flex-col gap-2"
      >
        <Label
          id="wa-footer-label"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Footer <span className="font-normal normal-case">(optional)</span>
        </Label>
        <Input
          value={wa.footer}
          maxLength={WA_FOOTER_LIMIT}
          placeholder="Small print, e.g. opt-out instructions"
          onChange={(e) => onPatch({ footer: e.target.value })}
        />
      </section>

      <Separator />

      {/* Buttons block */}
      <section
        aria-labelledby="wa-buttons-label"
        className="flex flex-col gap-2"
      >
        <div className="flex items-center justify-between">
          <Label
            id="wa-buttons-label"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Buttons{' '}
            <span className="font-normal normal-case">
              ({wa.buttons.length}/{WA_BUTTON_LIMIT})
            </span>
          </Label>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={wa.buttons.length >= WA_BUTTON_LIMIT}
              onClick={() => addButton('quick_reply')}
            >
              <Reply className="size-3.5" aria-hidden="true" /> Reply
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={wa.buttons.length >= WA_BUTTON_LIMIT}
              onClick={() => addButton('url')}
            >
              <Link2 className="size-3.5" aria-hidden="true" /> URL
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={wa.buttons.length >= WA_BUTTON_LIMIT}
              onClick={() => addButton('call')}
            >
              <Phone className="size-3.5" aria-hidden="true" /> Call
            </Button>
          </div>
        </div>
        {wa.buttons.length === 0 ? (
          <p className="border-border bg-muted/30 text-muted-foreground rounded-lg border border-dashed p-3 text-center text-xs">
            No buttons yet. Add quick replies or links — drag rows to reorder.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {wa.buttons.map((btn, i) => (
              <ButtonRow
                key={btn.id}
                button={btn}
                index={i}
                isDragTarget={
                  overIndex === i && dragIndex !== null && dragIndex !== i
                }
                onChange={(updated) =>
                  onPatch({
                    buttons: wa.buttons.map((b) =>
                      b.id === updated.id ? updated : b
                    ),
                  })
                }
                onRemove={() =>
                  onPatch({
                    buttons: wa.buttons.filter((b) => b.id !== btn.id),
                  })
                }
                onDragStart={setDragIndex}
                onDragOver={(idx, e) => {
                  e.preventDefault();
                  setOverIndex(idx);
                }}
                onDrop={reorder}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SmsEditor({
  template,
  onPatch,
}: {
  template: StudioTemplate;
  onPatch: (patch: Partial<StudioTemplate['sms']>) => void;
}) {
  const sms = template.sms;
  const meta = useMemo(() => analyzeSms(sms.body), [sms.body]);

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="sms-body-label" className="flex flex-col gap-2">
        <Label
          id="sms-body-label"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Message
        </Label>
        <Textarea
          value={sms.body}
          rows={7}
          placeholder={'Write your SMS. Keep it tight — every segment counts.'}
          onChange={(e) => onPatch({ body: e.target.value })}
          className="resize-y font-sans text-sm leading-relaxed"
        />
        <VariableChips
          onInsert={(token) =>
            onPatch({
              body: `${sms.body}${sms.body && !sms.body.endsWith(' ') ? ' ' : ''}${token}`,
            })
          }
        />
      </section>

      {/* Segment meter */}
      <section
        aria-label="SMS length and cost meter"
        className="border-border bg-card flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-3"
      >
        <div>
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Encoding
          </p>
          <p
            className={cn(
              'text-sm font-semibold',
              meta.encoding === 'Unicode'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-foreground'
            )}
          >
            {meta.encoding}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Characters
          </p>
          <p className="text-foreground text-sm font-semibold tabular-nums">
            {meta.charCount}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Segments
          </p>
          <p
            className={cn(
              'text-sm font-semibold tabular-nums',
              meta.segments > 1
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-foreground'
            )}
          >
            {meta.segments} {meta.segments === 1 ? 'message' : 'messages'}
          </p>
        </div>
        <div className="min-w-32 flex-1">
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                meta.segments > 1 ? 'bg-amber-500' : 'bg-primary'
              )}
              style={{
                width: `${Math.min(100, ((meta.charCount % meta.perSegment === 0 && meta.charCount > 0 ? meta.perSegment : meta.charCount % meta.perSegment) / meta.perSegment) * 100)}%`,
              }}
            />
          </div>
          <p className="text-muted-foreground mt-1 text-right text-[11px] tabular-nums">
            {meta.perSegment -
              (meta.charCount % meta.perSegment === 0 && meta.charCount > 0
                ? meta.perSegment
                : meta.charCount % meta.perSegment)}{' '}
            left in this segment
          </p>
        </div>
        {meta.encoding === 'Unicode' && (
          <p className="w-full text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            An emoji or special character switched this message to Unicode,
            shrinking each segment to {meta.perSegment} characters.
          </p>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------
// Studio shell
// ------------------------------------------------------------

export function TemplateStudio() {
  // Account variable library — SWR-cached, shared with VariableChips
  // (same key, so this adds no extra fetch). The preview needs it to
  // substitute custom {{tokens}} with their sample values.
  const { variables: customVariables } = useTemplateVariables();
  const {
    templates: serverTemplates,
    isLoading,
    loadError,
    save,
    submit,
    syncStatuses,
    importTemplates,
    remove,
  } = useStudioTemplates();

  // Unsaved work: brand-new templates + local edits of server rows.
  // Merged over the SWR list so typing never fights revalidation.
  const [newDrafts, setNewDrafts] = useState<StudioTemplate[]>([]);
  const [edits, setEdits] = useState<Record<string, StudioTemplate>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceKind>('iphone');
  const [busy, setBusy] = useState<
    'save' | 'submit' | 'delete' | 'sync' | null
  >(null);

  const templates = useMemo(
    () => [...newDrafts, ...serverTemplates.map((t) => edits[t.id] ?? t)],
    [newDrafts, serverTemplates, edits]
  );

  const active =
    templates.find((t) => t.id === activeId) ?? templates[0] ?? null;
  const isDirty = active ? active.isNew === true || active.id in edits : false;

  // Live compose-time compliance: the same pure checks the API runs
  // at save, so members see Meta/Twilio/TCPA problems while typing —
  // not after a rejected submission.
  const complianceIssues = useMemo(() => {
    if (!active) return [];
    if (active.channel === 'whatsapp') {
      if (!active.whatsapp.body.trim()) return [];
      return checkCompliance({
        channel: 'whatsapp',
        category: active.category,
        body: active.whatsapp.body,
        footer: active.whatsapp.footer,
        hasButtons: active.whatsapp.buttons.length > 0,
      }).issues;
    }
    if (!active.sms.body.trim()) return [];
    return checkCompliance({
      channel: 'sms',
      category: SMS_CATEGORY_FOR_CHECK[active.category],
      body: active.sms.body,
    }).issues;
  }, [active]);

  const patchActive = (patch: Partial<StudioTemplate>) => {
    if (!active) return;
    const next = { ...active, ...patch };
    if (active.isNew) {
      setNewDrafts((prev) => prev.map((t) => (t.id === active.id ? next : t)));
    } else {
      setEdits((prev) => ({ ...prev, [active.id]: next }));
    }
  };

  const createTemplate = () => {
    const tpl = blankTemplate();
    setNewDrafts((prev) => [tpl, ...prev]);
    setActiveId(tpl.id);
  };

  const clearLocal = (id: string) => {
    setNewDrafts((prev) => prev.filter((t) => t.id !== id));
    setEdits((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleSave = async () => {
    if (!active) return;
    setBusy('save');
    try {
      const savedId = await save(active);
      clearLocal(active.id);
      setActiveId(savedId);
      toast.success(
        active.channel === 'sms'
          ? 'SMS template saved and active.'
          : 'Draft saved.'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleSubmit = async () => {
    if (!active) return;
    setBusy('submit');
    try {
      await submit(active);
      clearLocal(active.id);
      toast.success(
        active.provider === 'twilio'
          ? 'Submitted to Twilio for WhatsApp approval.'
          : 'Submitted to Meta for review.'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submission failed.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Pull approval statuses from Twilio (bulk ContentAndApprovals).
   * Rendered only for Twilio-provider WhatsApp templates — Meta rows
   * sync via their own /sync route and SMS never needs approval.
   */
  const handleSyncStatuses = async () => {
    setBusy('sync');
    try {
      const summary = await syncStatuses();
      toast.success(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Status sync failed.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Rail-level "Sync templates": imports the full WhatsApp template
   * catalog from every connected provider (Twilio Content API and/or
   * Meta WABA) and refreshes approval statuses — works even when no
   * local template exists yet.
   */
  const handleImportTemplates = async () => {
    setBusy('sync');
    try {
      const summary = await importTemplates();
      toast.success(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Template sync failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!active) return;
    if (active.isNew) {
      clearLocal(active.id);
      setActiveId(null);
      return;
    }
    setBusy('delete');
    try {
      await remove(active.id);
      clearLocal(active.id);
      setActiveId(null);
      toast.success('Template deleted.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!active) {
    return (
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <TemplateRail
          templates={templates}
          activeId=""
          isLoading={isLoading}
          onSelect={setActiveId}
          onCreate={createTemplate}
          onSync={handleImportTemplates}
          isSyncing={busy === 'sync'}
        />
        <div className="border-border text-muted-foreground flex min-h-64 flex-1 items-center justify-center rounded-xl border border-dashed text-sm">
          {loadError ??
            (isLoading
              ? 'Loading templates…'
              : 'Select a template or create a new one.')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <TemplateRail
        templates={templates}
        activeId={active.id}
        isLoading={isLoading}
        onSelect={setActiveId}
        onCreate={createTemplate}
        onSync={handleImportTemplates}
        isSyncing={busy === 'sync'}
      />

      {/* Editor pane */}
      <div className="border-border bg-card min-w-0 flex-1 rounded-xl border p-4 sm:p-5">
        {/* Meta row */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1">
            <Label
              htmlFor="tpl-name"
              className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
            >
              Template name
            </Label>
            <Input
              id="tpl-name"
              value={active.name}
              onChange={(e) => patchActive({ name: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Category
            </Label>
            <Select
              value={active.category}
              onValueChange={(v) =>
                patchActive({ category: v as StudioTemplate['category'] })
              }
            >
              <SelectTrigger className="mt-1.5 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marketing">Marketing</SelectItem>
                <SelectItem value="utility">Utility</SelectItem>
                <SelectItem value="authentication">Authentication</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Language
            </Label>
            <Select
              value={active.language}
              onValueChange={(v) => v && patchActive({ language: v })}
            >
              <SelectTrigger className="mt-1.5 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en_US">en_US</SelectItem>
                <SelectItem value="en_GB">en_GB</SelectItem>
                <SelectItem value="hi_IN">hi_IN</SelectItem>
                <SelectItem value="te_IN">te_IN</SelectItem>
                <SelectItem value="es_ES">es_ES</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Channel switch */}
        <Tabs
          value={active.channel}
          onValueChange={(v) => patchActive({ channel: v as TemplateChannel })}
          className="mt-5"
        >
          <TabsList className="grid w-full max-w-xs grid-cols-2">
            <TabsTrigger value="whatsapp" className="gap-1.5">
              <MessageSquareText className="size-4" aria-hidden="true" />{' '}
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="sms" className="gap-1.5">
              <Smartphone className="size-4" aria-hidden="true" /> SMS
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Separator className="my-5" />

        {active.channel === 'whatsapp' ? (
          <WhatsAppEditor
            template={active}
            onPatch={(p) =>
              patchActive({ whatsapp: { ...active.whatsapp, ...p } })
            }
          />
        ) : (
          <SmsEditor
            template={active}
            onPatch={(p) => patchActive({ sms: { ...active.sms, ...p } })}
          />
        )}

        {/* Footer actions — persistence + provider submission */}
        <Separator className="my-5" />
        {active.errorMessage && (
          <p className="bg-destructive/10 text-destructive mb-3 rounded-lg px-3 py-2 text-xs leading-relaxed">
            {active.errorMessage}
          </p>
        )}
        {complianceIssues.length > 0 && (
          <div
            className="mb-3 flex flex-col gap-1.5"
            role="status"
            aria-label="Compliance checks"
          >
            {complianceIssues.map((ci) => (
              <p
                key={ci.code}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs leading-relaxed',
                  ci.level === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                )}
              >
                <span className="font-semibold">
                  {ci.level === 'error' ? 'Blocks saving: ' : 'Review: '}
                </span>
                {ci.message}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {active.channel === 'whatsapp' && (
              <div className="flex items-center gap-2">
                <Label className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Provider
                </Label>
                <Select
                  value={active.provider === 'twilio' ? 'twilio' : 'meta'}
                  onValueChange={(v) =>
                    patchActive({ provider: v as StudioTemplate['provider'] })
                  }
                >
                  <SelectTrigger className="h-8 w-40" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta">Meta (Cloud API)</SelectItem>
                    <SelectItem value="twilio">Twilio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {isDirty && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Unsaved changes
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={busy !== null}
              className="text-destructive hover:text-destructive"
            >
              {busy === 'delete' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={busy !== null}
            >
              {busy === 'save' && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              {active.channel === 'sms' ? 'Save template' : 'Save draft'}
            </Button>
            {active.channel === 'whatsapp' && active.provider === 'twilio' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncStatuses}
                disabled={busy !== null}
              >
                {busy === 'sync' ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
                Sync statuses
              </Button>
            )}
            {active.channel === 'whatsapp' && (
              <Button size="sm" onClick={handleSubmit} disabled={busy !== null}>
                {busy === 'submit' && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Submit for review
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Preview pane */}
      <aside
        className="flex w-full shrink-0 flex-col items-center gap-4 lg:w-[320px]"
        aria-label="Live preview"
      >
        <Tabs value={device} onValueChange={(v) => setDevice(v as DeviceKind)}>
          <TabsList>
            <TabsTrigger value="iphone" className="px-4">
              iPhone
            </TabsTrigger>
            <TabsTrigger value="android" className="px-4">
              Android
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <PhonePreview
          device={device}
          channel={active.channel}
          whatsapp={active.whatsapp}
          sms={active.sms}
          customVariables={customVariables}
        />
        <p className="text-muted-foreground text-center text-[11px] leading-snug">
          Live preview with sample data — variables like{' '}
          <span className="text-primary font-mono">{'{{first_name}}'}</span> are
          filled automatically.
        </p>
      </aside>
    </div>
  );
}
