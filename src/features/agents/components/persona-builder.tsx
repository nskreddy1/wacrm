'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Eye, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  composePersonaPrompt,
  INDUSTRY_OPTIONS,
  TONE_OPTIONS,
  type IndustryKey,
  type PersonaConfig,
  type ToneKey,
} from '@/features/assistant/lib/ai/persona';

// ------------------------------------------------------------------
// Guided persona builder — clients answer plain-language questions;
// the platform composes the enterprise-grade system prompt for them.
// No prompt-engineering knowledge required. The composed prompt is
// previewable (read-only) so founders can audit what will run.
//
// Controlled component: parent owns the PersonaConfig draft and
// submits it as `persona_config` — the SERVER re-composes the prompt
// authoritatively (client compose here is preview-only).
// ------------------------------------------------------------------

/** A blank draft to start from. */
export function emptyPersonaDraft(): PersonaConfig {
  return {
    industry: 'services',
    tone: 'friendly',
    businessName: '',
    businessDescription: '',
    workingHours: '',
    keyFacts: [],
    language: '',
    neverDo: [],
    signature: '',
  };
}

export function PersonaBuilder({
  value,
  onChange,
  disabled,
}: {
  value: PersonaConfig;
  onChange: (next: PersonaConfig) => void;
  disabled?: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);

  // Live preview of the exact prompt the server will compose.
  const preview = useMemo(() => {
    if (!value.businessName.trim()) return null;
    return composePersonaPrompt({
      ...value,
      businessName: value.businessName.trim(),
      keyFacts: value.keyFacts?.filter((f) => f.trim()) ?? [],
      neverDo: value.neverDo?.filter((f) => f.trim()) ?? [],
    });
  }, [value]);

  const set = <K extends keyof PersonaConfig>(
    key: K,
    v: PersonaConfig[K]
  ) => onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-5">
      {/* Industry */}
      <div className="flex flex-col gap-2">
        <Label>What kind of business is this?</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {INDUSTRY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => set('industry', opt.value as IndustryKey)}
              aria-pressed={value.industry === opt.value}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                value.industry === opt.value
                  ? 'border-primary/50 bg-primary/5 ring-primary/30 ring-1'
                  : 'border-border bg-muted/30 hover:bg-muted'
              )}
            >
              <span className="text-foreground text-sm font-medium">
                {opt.label}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Business name + description */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pb-name">Business name</Label>
          <Input
            id="pb-name"
            value={value.businessName}
            onChange={(e) => set('businessName', e.target.value)}
            placeholder="e.g. Green Leaf Organics"
            maxLength={120}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pb-desc">What do you sell or do? (one line)</Label>
          <Input
            id="pb-desc"
            value={value.businessDescription ?? ''}
            onChange={(e) => set('businessDescription', e.target.value)}
            placeholder="e.g. Organic groceries delivered same-day"
            maxLength={300}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Tone */}
      <div className="flex flex-col gap-2">
        <Label>How should it talk to customers?</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => set('tone', opt.value as ToneKey)}
              aria-pressed={value.tone === opt.value}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                value.tone === opt.value
                  ? 'border-primary/50 bg-primary/5 ring-primary/30 ring-1'
                  : 'border-border bg-muted/30 hover:bg-muted'
              )}
            >
              <span className="text-foreground text-sm font-medium">
                {opt.label}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Hours + language */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pb-hours">Working hours (optional)</Label>
          <Input
            id="pb-hours"
            value={value.workingHours ?? ''}
            onChange={(e) => set('workingHours', e.target.value)}
            placeholder="e.g. Mon–Sat 9:00–19:00 IST"
            maxLength={120}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pb-lang">Main reply language (optional)</Label>
          <Input
            id="pb-lang"
            value={value.language ?? ''}
            onChange={(e) => set('language', e.target.value)}
            placeholder="e.g. English, or Hindi + English"
            maxLength={80}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Key facts */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="pb-facts">
          Key facts the agent may state (one per line)
        </Label>
        <Textarea
          id="pb-facts"
          value={(value.keyFacts ?? []).join('\n')}
          onChange={(e) => set('keyFacts', e.target.value.split('\n'))}
          placeholder={
            'Delivery in 3–5 business days\nFree shipping over ₹999\n7-day return policy on unused items'
          }
          rows={4}
          disabled={disabled}
        />
        <p className="text-muted-foreground text-xs">
          These become the only facts the agent is allowed to state — anything
          else it will check with your team. Add prices, policies, addresses,
          and offers here or in the Knowledge Base.
        </p>
      </div>

      {/* Never-do list */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="pb-never">
          Things it must never do (optional, one per line)
        </Label>
        <Textarea
          id="pb-never"
          value={(value.neverDo ?? []).join('\n')}
          onChange={(e) => set('neverDo', e.target.value.split('\n'))}
          placeholder={'Promise exact delivery dates\nOffer discounts beyond listed offers'}
          rows={3}
          disabled={disabled}
        />
      </div>

      {/* Sign-off */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="pb-sign">Preferred sign-off (optional)</Label>
        <Input
          id="pb-sign"
          value={value.signature ?? ''}
          onChange={(e) => set('signature', e.target.value)}
          placeholder='e.g. "— Team Green Leaf"'
          maxLength={120}
          disabled={disabled}
        />
      </div>

      {/* Prompt preview (audit view — read-only) */}
      <div className="border-border rounded-lg border">
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-between px-3"
          onClick={() => setShowPreview((s) => !s)}
        >
          <span className="flex items-center gap-2">
            <Eye className="size-4" aria-hidden />
            Preview the generated instructions
          </span>
          <ChevronDown
            className={cn(
              'size-4 transition-transform',
              showPreview && 'rotate-180'
            )}
            aria-hidden
          />
        </Button>
        {showPreview && (
          <div className="border-border border-t px-3 py-3">
            {preview ? (
              <pre className="text-muted-foreground max-h-72 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {preview}
              </pre>
            ) : (
              <p className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
                <Sparkles className="size-4" aria-hidden />
                Fill in the business name to see the generated instructions.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
