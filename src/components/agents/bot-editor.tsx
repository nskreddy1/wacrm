'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { BOT_TONES } from '@/lib/ai/bot-templates';
import type { BotTemplate } from '@/lib/ai/bot-templates';
import type { BotTone, WorkingHours } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { TONE_LABEL, type BotRow } from './bot-types';

// Radix Select can't use an empty-string item value.
const HANDOFF_QUEUE = '__queue__';

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const;

type DayKey = (typeof DAYS)[number]['key'];

interface DayHours {
  enabled: boolean;
  start: string;
  end: string;
}

const DEFAULT_DAY: DayHours = { enabled: false, start: '09:00', end: '18:00' };

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface BotEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing bot to edit; null = create new. */
  bot: BotRow | null;
  /** Prefill for "create from template" / duplicate flows. */
  prefill?: Partial<BotRow> & { template_key?: string | null };
  onSaved: () => void;
  /** Opens the template gallery from within the editor. */
  onBrowseTemplates?: () => void;
}

export function BotEditor({
  open,
  onOpenChange,
  bot,
  prefill,
  onSaved,
  onBrowseTemplates,
}: BotEditorProps) {
  const [saving, setSaving] = useState(false);

  // Identity
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [description, setDescription] = useState('');
  // Persona
  const [systemPrompt, setSystemPrompt] = useState('');
  const [tone, setTone] = useState<BotTone>('friendly');
  const [language, setLanguage] = useState('');
  const [greeting, setGreeting] = useState('');
  // Advanced
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [temperature, setTemperature] = useState(''); // '' = provider default
  const [modelOverride, setModelOverride] = useState('');
  const [maxReplies, setMaxReplies] = useState(''); // '' = account default
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [useKb, setUseKb] = useState(true);
  // Working hours
  const [hoursEnabled, setHoursEnabled] = useState(false);
  const [timezone, setTimezone] = useState(guessTimezone());
  const [days, setDays] = useState<Record<DayKey, DayHours>>(() =>
    Object.fromEntries(DAYS.map((d) => [d.key, { ...DEFAULT_DAY }])) as Record<
      DayKey,
      DayHours
    >,
  );
  const [outsideBehavior, setOutsideBehavior] = useState<'silent' | 'away_message'>(
    'silent',
  );
  const [awayMessage, setAwayMessage] = useState('');

  const [members, setMembers] = useState<AccountMember[]>([]);
  const [templateKey, setTemplateKey] = useState<string | null>(null);

  // Re-seed the form whenever the sheet opens for a (different) subject.
  useEffect(() => {
    if (!open) return;
    const src = bot ?? prefill ?? null;
    setName(src?.name ?? '');
    setEmoji(src?.emoji ?? '');
    setDescription(src?.description ?? '');
    setSystemPrompt(src?.system_prompt ?? '');
    setTone((src?.tone as BotTone) ?? 'friendly');
    setLanguage(src?.language && src.language !== 'auto' ? src.language : '');
    setGreeting(src?.greeting_message ?? '');
    setTemperature(
      src?.temperature === null || src?.temperature === undefined
        ? ''
        : String(src.temperature),
    );
    setModelOverride(src?.model_override ?? '');
    setMaxReplies(
      src?.auto_reply_max_per_conversation === null ||
        src?.auto_reply_max_per_conversation === undefined
        ? ''
        : String(src.auto_reply_max_per_conversation),
    );
    setHandoffAgentId(src?.handoff_agent_id ?? '');
    setUseKb(src?.use_knowledge_base ?? true);
    setTemplateKey(src?.template_key ?? null);
    setOutsideBehavior(src?.outside_hours_behavior ?? 'silent');
    setAwayMessage(src?.away_message ?? '');

    const wh = src?.working_hours ?? null;
    setHoursEnabled(Boolean(wh));
    setTimezone(wh?.timezone ?? guessTimezone());
    setDays(
      Object.fromEntries(
        DAYS.map((d) => {
          const day = wh?.days?.[d.key];
          return [
            d.key,
            day
              ? { enabled: true, start: day.start, end: day.end }
              : { ...DEFAULT_DAY },
          ];
        }),
      ) as Record<DayKey, DayHours>,
    );
    // Advanced stays open when editing a bot that uses advanced fields.
    setAdvancedOpen(
      Boolean(
        src &&
          (src.temperature !== null ||
            src.model_override ||
            src.working_hours ||
            src.use_knowledge_base === false),
      ),
    );
  }, [open, bot, prefill]);

  useEffect(() => {
    if (open) void fetchAccountMembers().then(setMembers);
  }, [open]);

  const workingHoursPayload = (): WorkingHours | null => {
    if (!hoursEnabled) return null;
    const dayEntries = Object.fromEntries(
      DAYS.map((d) => {
        const v = days[d.key];
        return [d.key, v.enabled ? { start: v.start, end: v.end } : null];
      }),
    );
    return { timezone: timezone.trim() || 'UTC', days: dayEntries };
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give the bot a name.');
      return;
    }
    if (!systemPrompt.trim()) {
      toast.error('The bot needs a system prompt — that IS the bot.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        emoji: emoji.trim() || null,
        description: description.trim() || null,
        system_prompt: systemPrompt.trim(),
        tone,
        language: language.trim() || 'auto',
        greeting_message: greeting.trim() || null,
        temperature: temperature === '' ? null : Number(temperature),
        model_override: modelOverride.trim() || null,
        auto_reply_max_per_conversation:
          maxReplies === '' ? null : Number(maxReplies),
        handoff_agent_id: handoffAgentId || null,
        working_hours: workingHoursPayload(),
        outside_hours_behavior: outsideBehavior,
        away_message: awayMessage.trim() || null,
        use_knowledge_base: useKb,
        template_key: templateKey,
      };
      const res = await fetch(bot ? `/api/ai/bots/${bot.id}` : '/api/ai/bots', {
        method: bot ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save bot');
        return;
      }
      toast.success(bot ? 'Bot updated' : 'Bot created');
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error('Failed to save bot');
    } finally {
      setSaving(false);
    }
  };

  const temperatureNumber = temperature === '' ? null : Number(temperature);
  const temperatureInvalid =
    temperatureNumber !== null &&
    (!Number.isFinite(temperatureNumber) ||
      temperatureNumber < 0 ||
      temperatureNumber > 2);

  const memberItems = useMemo(
    () =>
      members.map((m) => ({ value: m.user_id, label: memberLabel(m) })),
    [members],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{bot ? 'Edit bot' : 'New bot'}</SheetTitle>
          <SheetDescription>
            {bot
              ? 'Changes apply to future replies immediately after saving.'
              : 'A bot is a persona on top of your connected AI provider.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-4">
          {/* Identity */}
          <div className="grid grid-cols-[4.5rem_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor="bot-emoji">Emoji</Label>
              <Input
                id="bot-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🤖"
                className="text-center"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bot-name">Name</Label>
              <Input
                id="bot-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Support Assistant"
                maxLength={80}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bot-description">Description</Label>
            <Input
              id="bot-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this bot for? (shown only to your team)"
              maxLength={500}
            />
          </div>

          {/* Persona */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="bot-prompt">System prompt</Label>
              {onBrowseTemplates && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-xs text-primary"
                  onClick={onBrowseTemplates}
                >
                  <Sparkles className="mr-1 h-3 w-3" /> Start from template
                </Button>
              )}
            </div>
            <Textarea
              id="bot-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Describe who the bot is, what it should do, and what it must never do…"
              rows={8}
              maxLength={8000}
            />
            <p className="text-xs text-muted-foreground">
              Safety guardrails (no invented facts, hand off when unsure) are
              always added automatically — write the persona, not the rules.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tone</Label>
              <Select value={tone} onValueChange={(v) => setTone(v as BotTone)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOT_TONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TONE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bot-language">Language</Label>
              <Input
                id="bot-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="Auto — match the customer"
                maxLength={40}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bot-greeting">Greeting message</Label>
            <Textarea
              id="bot-greeting"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Optional — prepended to the bot's first reply in a conversation"
              rows={2}
              maxLength={1000}
            />
          </div>

          {/* Advanced */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-between px-2 text-sm font-medium"
                />
              }
            >
              Advanced
              <ChevronDown
                className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bot-temperature">Temperature</Label>
                  <Input
                    id="bot-temperature"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder="Provider default"
                    aria-invalid={temperatureInvalid}
                  />
                  <p className="text-xs text-muted-foreground">
                    0 = focused, 2 = creative. Empty = provider default.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bot-model">Model override</Label>
                  <Input
                    id="bot-model"
                    value={modelOverride}
                    onChange={(e) => setModelOverride(e.target.value)}
                    placeholder="Account default"
                    maxLength={120}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bot-max">Max replies / conversation</Label>
                  <Input
                    id="bot-max"
                    type="number"
                    min={1}
                    max={20}
                    value={maxReplies}
                    onChange={(e) => setMaxReplies(e.target.value)}
                    placeholder="Account default"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Handoff to</Label>
                  <Select
                    value={handoffAgentId || HANDOFF_QUEUE}
                    onValueChange={(v) =>
                      setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={HANDOFF_QUEUE}>
                        Shared queue (unassigned)
                      </SelectItem>
                      {memberItems.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Use knowledge base
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ground replies in your uploaded docs and FAQs.
                  </p>
                </div>
                <Switch checked={useKb} onCheckedChange={setUseKb} />
              </div>

              {/* Working hours */}
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Working hours
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Only auto-reply during these hours. Off = always on.
                    </p>
                  </div>
                  <Switch checked={hoursEnabled} onCheckedChange={setHoursEnabled} />
                </div>

                {hoursEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="bot-tz">Timezone</Label>
                      <Input
                        id="bot-tz"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        placeholder="e.g. Europe/Madrid"
                      />
                    </div>
                    <div className="space-y-1.5">
                      {DAYS.map((d) => {
                        const v = days[d.key];
                        return (
                          <div key={d.key} className="flex items-center gap-2">
                            <label className="flex w-16 items-center gap-1.5 text-sm">
                              <input
                                type="checkbox"
                                checked={v.enabled}
                                onChange={(e) =>
                                  setDays((prev) => ({
                                    ...prev,
                                    [d.key]: { ...v, enabled: e.target.checked },
                                  }))
                                }
                                className="accent-primary"
                              />
                              {d.label}
                            </label>
                            <Input
                              type="time"
                              value={v.start}
                              disabled={!v.enabled}
                              onChange={(e) =>
                                setDays((prev) => ({
                                  ...prev,
                                  [d.key]: { ...v, start: e.target.value },
                                }))
                              }
                              className="h-8 w-28"
                              aria-label={`${d.label} start`}
                            />
                            <span className="text-xs text-muted-foreground">to</span>
                            <Input
                              type="time"
                              value={v.end}
                              disabled={!v.enabled}
                              onChange={(e) =>
                                setDays((prev) => ({
                                  ...prev,
                                  [d.key]: { ...v, end: e.target.value },
                                }))
                              }
                              className="h-8 w-28"
                              aria-label={`${d.label} end`}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-2">
                      <Label>Outside hours</Label>
                      <Select
                        value={outsideBehavior}
                        onValueChange={(v) =>
                          setOutsideBehavior(v as 'silent' | 'away_message')
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="silent">
                            Stay silent — a human will follow up
                          </SelectItem>
                          <SelectItem value="away_message">
                            Send an away message (once per conversation)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {outsideBehavior === 'away_message' && (
                        <Textarea
                          value={awayMessage}
                          onChange={(e) => setAwayMessage(e.target.value)}
                          placeholder="We're currently closed — we'll get back to you first thing tomorrow."
                          rows={2}
                          maxLength={1000}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div className="sticky bottom-0 mt-auto flex justify-end gap-2 border-t border-border bg-card p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || temperatureInvalid}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {bot ? 'Save changes' : 'Create bot'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export type { BotTemplate };
