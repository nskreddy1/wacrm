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

import { useEffect, useMemo, useState } from 'react';

import {
  ChevronsRight,
  GripVertical,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  Mail,
  MessageSquareText,
  Phone,
  Plus,
  Reply,
  RefreshCw,
  Monitor,
  Send,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  CHANNEL_META,
  EMAIL_CATEGORY_LABELS,
  STATUS_META,
  TEMPLATE_VARIABLES,
  withSampleValues,
  type CustomTemplateVariable,
  type EmailCategory,
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

/** Email category → compliance tier (mirrors the API's mapping). */
const EMAIL_TIER_FOR_CHECK: Record<
  StudioTemplate['email']['category'],
  'marketing' | 'transactional' | 'otp'
> = {
  newsletter: 'marketing',
  promotional: 'marketing',
  transactional: 'transactional',
  onboarding: 'transactional',
  otp: 'otp',
};

/** Studio category → SMS compliance category (mirrors the hook's DB mapping). */
const SMS_CATEGORY_FOR_CHECK: Record<
  StudioTemplate['category'],
  'marketing' | 'transactional' | 'otp'
> = {
  marketing: 'marketing',
  utility: 'transactional',
  authentication: 'otp',
};

function blankTemplate(channel: TemplateChannel = 'whatsapp'): StudioTemplate {
  return {
    id: nextId('tpl-new'),
    name: 'Untitled template',
    channel,
    category: channel === 'whatsapp' ? 'utility' : 'marketing',
    language: 'en_US',
    status: 'draft',
    provider: channel === 'whatsapp' ? 'meta' : 'none',
    updatedAt: new Date().toISOString().slice(0, 10),
    whatsapp: {
      headerKind: 'none',
      headerText: '',
      body: '',
      footer: '',
      buttons: [],
    },
    sms: { body: '' },
    email: { subject: '', body: '', category: 'promotional' },
    isNew: true,
  };
}

// ------------------------------------------------------------
// Channel rail — the vertical studio switcher
// ------------------------------------------------------------

const STUDIO_CHANNELS: {
  channel: TemplateChannel;
  icon: typeof MessageSquareText;
}[] = [
  { channel: 'whatsapp', icon: MessageSquareText },
  { channel: 'sms', icon: Smartphone },
  { channel: 'email', icon: Mail },
];

/** localStorage key for the channel panel pin preference (pure UI state). */
const CHANNEL_PANEL_PREF_KEY = 'wacrm.templates.channel-panel';

/**
 * Zoho Bigin-style channel panel docked flush against the app
 * sidebar. Two modes:
 *
 * - Collapsed: slim icon strip + the open studio's name running
 *   vertically. Hovering peeks the full panel (unless hover is
 *   disabled from the panel footer).
 * - Expanded (pinned via the arrow at the bottom): a labelled
 *   "Channels" list with studio names and template counts.
 *
 * Clicking a channel switches the whole studio — template list,
 * editor, and preview — to that channel's library.
 */
function ChannelRail({
  active,
  counts,
  onSelect,
}: {
  active: TemplateChannel;
  counts: Record<TemplateChannel, number>;
  onSelect: (channel: TemplateChannel) => void;
}) {
  const [pinned, setPinned] = useState(false);
  const [hoverEnabled, setHoverEnabled] = useState(true);
  const [peeking, setPeeking] = useState(false);

  // Restore UI preference (not data — plain localStorage is fine).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHANNEL_PANEL_PREF_KEY);
      if (!raw) return;
      const pref = JSON.parse(raw) as { pinned?: boolean; hover?: boolean };
      if (typeof pref.pinned === 'boolean') setPinned(pref.pinned);
      if (typeof pref.hover === 'boolean') setHoverEnabled(pref.hover);
    } catch {
      /* corrupted pref — keep defaults */
    }
  }, []);

  const savePref = (pref: { pinned: boolean; hover: boolean }) => {
    try {
      localStorage.setItem(CHANNEL_PANEL_PREF_KEY, JSON.stringify(pref));
    } catch {
      /* storage unavailable — preference just won't persist */
    }
  };

  const expanded = pinned || (hoverEnabled && peeking);

  return (
    <nav
      aria-label="Template studios"
      onMouseEnter={() => setPeeking(true)}
      onMouseLeave={() => setPeeking(false)}
      className={cn(
        'bg-sidebar border-sidebar-border flex h-full shrink-0 flex-col overflow-hidden border-r transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
        expanded ? 'w-52' : 'w-12'
      )}
    >
      {/* Panel header — only meaningful when expanded */}
      <div
        className={cn(
          'transition-opacity duration-200',
          expanded
            ? 'px-3 pt-3 pb-1 opacity-100'
            : 'pointer-events-none h-0 overflow-hidden opacity-0'
        )}
      >
        <p className="text-sidebar-foreground text-sm font-semibold whitespace-nowrap">
          Choose a channel
        </p>
        <p className="text-sidebar-foreground/60 mt-0.5 text-[11px] leading-snug whitespace-nowrap">
          Each channel keeps its own templates
        </p>
      </div>

      <div
        className={cn(
          'flex flex-1 flex-col gap-1.5',
          expanded ? 'px-2 py-1' : 'items-center py-3'
        )}
      >
        {STUDIO_CHANNELS.map(({ channel, icon: Icon }) => {
          const meta = CHANNEL_META[channel];
          const isActive = channel === active;
          const button = (
            <button
              key={channel}
              type="button"
              onClick={() => onSelect(channel)}
              aria-current={isActive ? 'true' : undefined}
              aria-label={`${meta.studioLabel} (${counts[channel]} templates)`}
              className={cn(
                'relative flex items-center rounded-lg transition-all duration-150',
                expanded ? 'h-9 w-full gap-2.5 px-2.5' : 'size-9 justify-center',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
              )}
            >
              <Icon className="size-4.5 shrink-0" aria-hidden="true" />
              {expanded && (
                <>
                  <span className="flex-1 truncate text-left text-sm whitespace-nowrap">
                    {meta.label}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                      isActive
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-sidebar-accent text-sidebar-foreground/70'
                    )}
                  >
                    {counts[channel]}
                  </span>
                </>
              )}
              {!expanded && counts[channel] > 0 && !isActive && (
                <span
                  aria-hidden="true"
                  className="bg-primary absolute top-1 right-1 size-1.5 rounded-full"
                />
              )}
            </button>
          );
          if (expanded) return button;
          return (
            <Tooltip key={channel}>
              <TooltipTrigger render={button} />
              <TooltipContent side="right" sideOffset={8}>
                {meta.studioLabel} · {counts[channel]}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Collapsed: rotated label of the open studio (Zoho strip
            pattern — the strip itself names where you are). */}
        {!expanded && (
          <>
            <Separator className="bg-sidebar-border my-1.5 w-6" />
            <p
              aria-hidden="true"
              className="text-sidebar-foreground/70 flex-1 [writing-mode:vertical-rl] rotate-180 pb-1 text-center text-[11px] font-semibold tracking-widest uppercase select-none"
            >
              {CHANNEL_META[active].studioLabel}
            </p>
          </>
        )}
      </div>

      {/* Footer — hover toggle (expanded only) + pin/collapse arrow */}
      <div
        className={cn(
          'border-sidebar-border flex items-center border-t p-1.5',
          expanded ? 'justify-between gap-1' : 'justify-center'
        )}
      >
        {expanded && (
          <button
            type="button"
            onClick={() => {
              const next = !hoverEnabled;
              setHoverEnabled(next);
              savePref({ pinned, hover: next });
            }}
            className="text-sidebar-foreground/60 hover:text-sidebar-foreground truncate px-1.5 text-[11px] whitespace-nowrap transition-colors"
          >
            {hoverEnabled ? 'Disable hover panel' : 'Enable hover panel'}
          </button>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => {
                  const next = !pinned;
                  setPinned(next);
                  if (!next) setPeeking(false);
                  savePref({ pinned: next, hover: hoverEnabled });
                }}
                aria-label={
                  pinned ? 'Collapse channel panel' : 'Expand channel panel'
                }
                aria-expanded={expanded}
                className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
              >
                <ChevronsRight
                  className={cn(
                    'size-4 transition-transform duration-300',
                    pinned && 'rotate-180'
                  )}
                  aria-hidden="true"
                />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            {pinned ? 'Collapse panel' : 'Keep panel open'}
          </TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------
// Template rail
// ------------------------------------------------------------

function TemplateRail({
  templates,
  activeId,
  channel,
  isLoading,
  onSelect,
  onCreate,
  onSync,
  isSyncing,
}: {
  templates: StudioTemplate[];
  activeId: string;
  channel: TemplateChannel;
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
      {channel === 'whatsapp' && (
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
      )}
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
          No {CHANNEL_META[channel].label} templates yet. Create your first one
          to get started.
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
                  {CHANNEL_META[tpl.channel].label}
                </span>
                {/* Provider origin — Twilio and Meta templates coexist
                    (unique key includes provider), so the rail must
                    show which system each row lives in. */}
                {tpl.channel === 'whatsapp' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={cn(
                        'font-medium',
                        tpl.provider === 'twilio'
                          ? 'text-[#F22F46]/80'
                          : 'text-[#25D366]/90'
                      )}
                    >
                      {tpl.provider === 'twilio' ? 'Twilio' : 'Meta'}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  {tpl.channel === 'email'
                    ? EMAIL_CATEGORY_LABELS[tpl.email.category]
                    : CATEGORY_LABELS[tpl.category]}
                </span>
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

function EmailEditor({
  template,
  onPatch,
}: {
  template: StudioTemplate;
  onPatch: (patch: Partial<StudioTemplate['email']>) => void;
}) {
  const email = template.email;
  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby="email-subject-label"
        className="flex flex-col gap-2"
      >
        <Label
          id="email-subject-label"
          htmlFor="email-subject"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Subject
        </Label>
        <Input
          id="email-subject"
          value={email.subject}
          placeholder="e.g. Your order {{1}} has shipped"
          onChange={(e) => onPatch({ subject: e.target.value })}
        />
      </section>

      <section
        aria-labelledby="email-body-label"
        className="flex flex-col gap-2"
      >
        <Label
          id="email-body-label"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Body
        </Label>
        <Textarea
          value={email.body}
          rows={12}
          placeholder={
            'Write your email. Plain text with variables — {{first_name}}, {{company}}…\n\nMarketing emails must include an unsubscribe line.'
          }
          onChange={(e) => onPatch({ body: e.target.value })}
          className="resize-y font-sans text-sm leading-relaxed"
        />
        <VariableChips
          onInsert={(token) =>
            onPatch({
              body: `${email.body}${email.body && !email.body.endsWith(' ') ? ' ' : ''}${token}`,
            })
          }
        />
      </section>
    </div>
  );
}

/**
 * Advanced email preview (Litmus/Mailchimp pattern): two views —
 *
 * - "Inbox": a Gmail-style list row showing exactly what recipients
 *   see before opening: sender, subject, and the body's first line
 *   as the snippet/preheader. Includes truncation guidance (mobile
 *   clients cut subjects around 40 chars, snippets around 90).
 * - "Message": the opened email — header, subject, body with
 *   variables resolved, plus the unsubscribe footer zone.
 *
 * A desktop/mobile width toggle simulates both breakpoints, since
 * 40-60% of opens happen on phones.
 */
function EmailPreview({
  email,
  customVariables,
}: {
  email: StudioTemplate['email'];
  customVariables?: CustomTemplateVariable[];
}) {
  const [view, setView] = useState<'inbox' | 'message'>('message');
  const [mobile, setMobile] = useState(false);

  const fill = (text: string) => withSampleValues(text, customVariables);
  const subject = email.subject.trim()
    ? fill(email.subject)
    : 'Subject preview';
  const body = email.body.trim()
    ? fill(email.body)
    : 'Your email body will appear here as you type.';
  // Snippet = first non-empty line (what Gmail shows after the subject).
  const snippet =
    body
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  const subjectLimit = mobile ? 40 : 70;
  const subjectTooLong = subject.length > subjectLimit;
  const needsUnsub =
    email.category === 'newsletter' || email.category === 'promotional';
  const hasUnsub = /unsub|opt[ -]?out/i.test(email.body);

  return (
    <div className="flex w-full flex-col gap-2">
      {/* View + device toggles */}
      <div className="flex items-center justify-between gap-2">
        <div className="bg-muted flex rounded-lg p-0.5">
          {(['inbox', 'message'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors',
                view === v
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="bg-muted flex rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setMobile(false)}
            aria-pressed={!mobile}
            aria-label="Desktop width preview"
            className={cn(
              'flex items-center justify-center rounded-md px-2 py-1 transition-colors',
              !mobile
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Monitor className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setMobile(true)}
            aria-pressed={mobile}
            aria-label="Mobile width preview"
            className={cn(
              'flex items-center justify-center rounded-md px-2 py-1 transition-colors',
              mobile
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Smartphone className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className={cn(
          'border-border bg-card overflow-hidden rounded-xl border shadow-sm transition-all duration-300',
          mobile ? 'mx-auto w-full max-w-70' : 'w-full'
        )}
      >
        {view === 'inbox' ? (
          /* Gmail-style inbox row: what the recipient sees pre-open */
          <div className="flex items-start gap-2.5 px-3.5 py-3">
            <div className="bg-primary/15 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              A
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-foreground truncate text-xs font-bold">
                  Acme Workspace
                </p>
                <p className="text-muted-foreground shrink-0 text-[10px]">
                  9:41 AM
                </p>
              </div>
              <p className="text-foreground truncate text-xs font-semibold">
                {mobile && subject.length > 40
                  ? `${subject.slice(0, 40)}…`
                  : subject}
              </p>
              <p className="text-muted-foreground truncate text-[11px]">
                {snippet.length > 90 ? `${snippet.slice(0, 90)}…` : snippet}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
              <div className="bg-primary/15 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                A
              </div>
              <div className="min-w-0">
                <p className="text-foreground truncate text-xs font-semibold">
                  Acme Workspace
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  to customer@example.com
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 px-4 py-3">
              <p className="text-foreground text-sm font-semibold text-balance">
                {subject}
              </p>
              <p className="text-foreground/90 text-xs leading-relaxed whitespace-pre-wrap">
                {body}
              </p>
              {needsUnsub && (
                <p
                  className={cn(
                    'border-border mt-1 border-t pt-2 text-[10px]',
                    hasUnsub
                      ? 'text-muted-foreground'
                      : 'text-destructive font-medium'
                  )}
                >
                  {hasUnsub
                    ? 'Unsubscribe footer detected — required for marketing email.'
                    : 'Missing unsubscribe link — required for newsletters and promotional email (CAN-SPAM / India DPDP).'}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Truncation guidance under the preview */}
      <p
        className={cn(
          'text-[10px] leading-snug',
          subjectTooLong ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
        )}
      >
        Subject: {subject.length}/{subjectLimit} chars
        {subjectTooLong
          ? ` — will truncate on ${mobile ? 'mobile' : 'desktop'} clients.`
          : mobile
            ? ' — fits mobile clients.'
            : ' — fits desktop clients.'}
      </p>
    </div>
  );
}

/**
 * End-to-end test delivery: sends the SAVED template to one explicit
 * address through the workspace email layer (tenant provider first,
 * platform Resend fallback). Disabled until the template is saved so
 * what lands in the inbox always matches what the server has.
 */
function SendTestEmail({
  templateId,
  hasUnsavedEdits,
}: {
  templateId: string | null;
  hasUnsavedEdits: boolean;
}) {
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const disabled = !templateId || sending;

  const handleSend = async () => {
    if (!templateId || !to.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/templates/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, to: to.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sent?: boolean;
        provider?: string;
        error?: string;
      };
      if (res.ok && data.sent) {
        setResult({
          ok: true,
          message: `Sent via ${data.provider === 'platform_resend' ? 'Resend' : (data.provider ?? 'email provider')}. Check the inbox.`,
        });
      } else {
        setResult({
          ok: false,
          message: data.error ?? 'Send failed. Try again.',
        });
      }
    } catch {
      setResult({ ok: false, message: 'Network error. Try again.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-border bg-card w-full rounded-xl border p-3 shadow-sm">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Send a test
      </p>
      <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
        {templateId
          ? hasUnsavedEdits
            ? 'Save first — the test sends the last saved version.'
            : 'Delivers the saved template with sample data to one address.'
          : 'Save the template to enable test sending.'}
      </p>
      <div className="mt-2 flex gap-1.5">
        <Input
          type="email"
          value={to}
          placeholder="you@company.com"
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              handleSend();
            }
          }}
          disabled={disabled}
          className="h-8 flex-1 text-xs"
          aria-label="Test recipient email"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={disabled || !to.trim()}
          className="h-8"
        >
          {sending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )}
          Send
        </Button>
      </div>
      {result && (
        <p
          role="status"
          className={cn(
            'mt-2 text-[11px] leading-snug',
            result.ok ? 'text-emerald-600 dark:text-emerald-500' : 'text-destructive'
          )}
        >
          {result.message}
        </p>
      )}
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
    checkStatus,
    importTemplates,
    remove,
  } = useStudioTemplates();

  // Unsaved work: brand-new templates + local edits of server rows.
  // Merged over the SWR list so typing never fights revalidation.
  const [newDrafts, setNewDrafts] = useState<StudioTemplate[]>([]);
  const [edits, setEdits] = useState<Record<string, StudioTemplate>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceKind>('iphone');
  // Which studio is open (WhatsApp / SMS / Email). Templates are
  // stored per channel — the rail only ever lists the open studio's
  // templates, so each channel keeps its own library.
  const [studioChannel, setStudioChannel] =
    useState<TemplateChannel>('whatsapp');
  const [busy, setBusy] = useState<
    'save' | 'submit' | 'delete' | 'sync' | null
  >(null);

  const allTemplates = useMemo(
    () => [...newDrafts, ...serverTemplates.map((t) => edits[t.id] ?? t)],
    [newDrafts, serverTemplates, edits]
  );

  const templates = useMemo(
    () => allTemplates.filter((t) => t.channel === studioChannel),
    [allTemplates, studioChannel]
  );

  // Per-channel library sizes, surfaced in the channel rail so you
  // can see at a glance where templates live before switching.
  const channelCounts = useMemo(() => {
    const counts: Record<TemplateChannel, number> = {
      whatsapp: 0,
      sms: 0,
      email: 0,
    };
    for (const t of allTemplates) counts[t.channel] += 1;
    return counts;
  }, [allTemplates]);

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
    if (active.channel === 'email') {
      // Email runs its own CAN-SPAM / Gmail-Yahoo bulk-sender rule
      // set (unsubscribe link, postal address, deceptive subjects,
      // spam-filter triggers) — same checks the API enforces at save.
      if (!active.email.body.trim()) return [];
      return checkCompliance({
        channel: 'email',
        category: EMAIL_TIER_FOR_CHECK[active.email.category],
        subject: active.email.subject,
        body: active.email.body,
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
    const tpl = blankTemplate(studioChannel);
    setNewDrafts((prev) => [tpl, ...prev]);
    setActiveId(tpl.id);
  };

  const switchStudio = (channel: TemplateChannel) => {
    setStudioChannel(channel);
    // Selection belongs to the previous channel's list — reset so
    // the new studio opens on its own first template.
    setActiveId(null);
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
        active.channel === 'whatsapp'
          ? 'Draft saved.'
          : `${CHANNEL_META[active.channel].label} template saved and active.`
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
   * Per-template review check: "was THIS template approved yet?"
   * Fetches only the active template's approval from Twilio and
   * updates its row. Bulk import/refresh lives on the rail button
   * (handleImportTemplates) — this one answers for one template.
   */
  const handleCheckStatus = async () => {
    if (!active) return;
    setBusy('sync');
    try {
      const summary = await checkStatus(active);
      toast.success(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Status check failed.');
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
      <div className="flex h-full min-h-0 w-full">
        <ChannelRail
          active={studioChannel}
          counts={channelCounts}
          onSelect={switchStudio}
        />
        <div
          key={studioChannel}
          className="studio-switch app-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:flex-row lg:items-start"
        >
          <TemplateRail
            templates={templates}
            activeId=""
            channel={studioChannel}
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
                : `Select a ${CHANNEL_META[studioChannel].label} template or create a new one.`)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <ChannelRail
        active={studioChannel}
        counts={channelCounts}
        onSelect={switchStudio}
      />
      <div
        key={studioChannel}
        className="studio-switch app-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:flex-row lg:items-start"
      >
      <TemplateRail
        templates={templates}
        activeId={active.id}
        channel={studioChannel}
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
            {active.channel === 'email' ? (
              // Email intent categories — they drive compliance rules
              // (newsletter/promotional require unsubscribe; OTP must
              // not carry marketing content).
              <Select
                value={active.email.category}
                onValueChange={(v) =>
                  v &&
                  patchActive({
                    email: {
                      ...active.email,
                      category: v as EmailCategory,
                    },
                  })
                }
              >
                <SelectTrigger className="mt-1.5 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(EMAIL_CATEGORY_LABELS) as [
                      EmailCategory,
                      string,
                    ][]
                  ).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
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
                  {/* Meta bills per delivered template message and the
                      gap is large (marketing ≈ 7× utility; utility is
                      free inside an open 24h service window) — surface
                      that at decision time. Meta reviews the CONTENT,
                      so promo copy in a "utility" template gets
                      rejected or force-recategorized. */}
                  <SelectItem value="utility">
                    <span className="flex flex-col items-start">
                      <span>Utility</span>
                      <span className="text-muted-foreground text-xs">
                        Order updates, reminders — lowest cost
                      </span>
                    </span>
                  </SelectItem>
                  <SelectItem value="marketing">
                    <span className="flex flex-col items-start">
                      <span>Marketing</span>
                      <span className="text-muted-foreground text-xs">
                        Promos, offers — highest per-message cost
                      </span>
                    </span>
                  </SelectItem>
                  <SelectItem value="authentication">
                    <span className="flex flex-col items-start">
                      <span>Authentication</span>
                      <span className="text-muted-foreground text-xs">
                        OTP codes only — fixed Meta format
                      </span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
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

        {/* Studio badge — the channel is fixed per studio; switch
            studios with the vertical rail on the far left. */}
        <div className="mt-5 flex items-center gap-2">
          <span className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
            {studioChannel === 'whatsapp' ? (
              <MessageSquareText className="size-3.5" aria-hidden="true" />
            ) : studioChannel === 'sms' ? (
              <Smartphone className="size-3.5" aria-hidden="true" />
            ) : (
              <Mail className="size-3.5" aria-hidden="true" />
            )}
            {CHANNEL_META[studioChannel].studioLabel}
          </span>
        </div>

        <Separator className="my-5" />

        {active.channel === 'whatsapp' ? (
          <WhatsAppEditor
            template={active}
            onPatch={(p) =>
              patchActive({ whatsapp: { ...active.whatsapp, ...p } })
            }
          />
        ) : active.channel === 'email' ? (
          <EmailEditor
            template={active}
            onPatch={(p) => patchActive({ email: { ...active.email, ...p } })}
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
                {active.providerLocked ? (
                  // Provider is immutable once the template lives in a
                  // provider's system (synced from Twilio/Meta, or
                  // submitted for review) — the row mirrors a remote
                  // object and re-homing it would orphan that link.
                  <span
                    className="bg-muted text-muted-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium"
                    title="Provider is locked because this template exists in the provider's system. Create a new template to target a different provider."
                  >
                    <Lock className="size-3" aria-hidden="true" />
                    {active.provider === 'twilio'
                      ? 'Twilio'
                      : 'Meta (Cloud API)'}
                  </span>
                ) : (
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
                )}
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
              {active.channel === 'whatsapp' ? 'Save draft' : 'Save template'}
            </Button>
          {active.channel === 'whatsapp' &&
            active.provider === 'twilio' &&
            !active.isNew &&
            active.status !== 'draft' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckStatus}
                disabled={busy !== null}
              >
                {busy === 'sync' ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
                Check review status
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
        {active.channel === 'email' ? (
          <>
            <EmailPreview
              email={active.email}
              customVariables={customVariables}
            />
            <SendTestEmail
              templateId={active.isNew ? null : active.id}
              hasUnsavedEdits={Boolean(edits[active.id] || active.isNew)}
            />
          </>
        ) : (
          <>
            <Tabs
              value={device}
              onValueChange={(v) => setDevice(v as DeviceKind)}
            >
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
              channel={active.channel === 'sms' ? 'sms' : 'whatsapp'}
              whatsapp={active.whatsapp}
              sms={active.sms}
              customVariables={customVariables}
            />
          </>
        )}
        <p className="text-muted-foreground text-center text-[11px] leading-snug">
          Live preview with sample data — variables like{' '}
          <span className="text-primary font-mono">{'{{first_name}}'}</span> are
          filled automatically.
        </p>
      </aside>
      </div>
    </div>
  );
}
