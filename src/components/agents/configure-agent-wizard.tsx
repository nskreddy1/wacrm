'use client'

// ============================================================
// "Configure New Agent" wizard — Lumis-reference 3-step modal:
//   1 Identity      — name, purpose, agent type pills
//   2 Model & Prompt — provider pills, model, API key, prompt
//   3 Triggers      — assistant/auto-reply switches + active hours
//
// Saving composes the identity into the system prompt and POSTs the
// whole thing to the existing /api/ai/config endpoint (single-config
// backend), then flips the toggles. The prompt textarea in step 2 is
// pre-seeded from step 1 but stays fully editable.
// ============================================================

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ArrowRight, ArrowLeft } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const AGENT_TYPES = [
  {
    value: 'support',
    label: 'Customer Support',
    prompt:
      'You handle customer support for our business on WhatsApp. Answer questions about our products, orders and policies briefly and politely, in the customer\'s language.',
  },
  {
    value: 'sales',
    label: 'Sales Assistant',
    prompt:
      'You are a sales assistant for our business on WhatsApp. Qualify leads, answer product and pricing questions, and guide interested customers toward a purchase or a call with our team.',
  },
  {
    value: 'booking',
    label: 'Booking / Scheduling',
    prompt:
      'You help customers book appointments and answer availability questions for our business on WhatsApp. Collect the details needed for a booking and confirm them back clearly.',
  },
  {
    value: 'faq',
    label: 'FAQ Responder',
    prompt:
      'You answer frequently asked questions about our business on WhatsApp, using our knowledge base. Keep answers short and factual.',
  },
  {
    value: 'custom',
    label: 'Custom',
    prompt: '',
  },
] as const

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', placeholder: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Claude', placeholder: 'claude-sonnet-4-5' },
  { value: 'gemini', label: 'Gemini', placeholder: 'gemini-2.5-flash' },
  { value: 'groq', label: 'Groq', placeholder: 'llama-3.3-70b-versatile' },
] as const

const STEPS = ['Identity', 'Model & Prompt', 'Triggers'] as const

export function ConfigureAgentWizard({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [step, setStep] = useState(0)
  // Step 1
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [agentType, setAgentType] = useState<string>('support')
  // Step 2
  const [provider, setProvider] = useState<string>('openai')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptTouched, setPromptTouched] = useState(false)
  // Step 3
  const [assistantOn, setAssistantOn] = useState(true)
  const [autoReplyOn, setAutoReplyOn] = useState(false)
  const [saving, setSaving] = useState(false)

  const providerMeta = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0]

  // Compose the default prompt from identity whenever the user hasn't
  // hand-edited it (keeps steps 1 → 2 feeling connected).
  function composedPrompt(): string {
    const typeMeta = AGENT_TYPES.find((t) => t.value === agentType)
    const parts = [
      name.trim() ? `You are "${name.trim()}".` : null,
      typeMeta?.prompt || null,
      purpose.trim() ? `Purpose: ${purpose.trim()}` : null,
    ].filter(Boolean)
    return parts.join(' ')
  }

  function goNext() {
    if (step === 0) {
      if (!name.trim()) {
        toast.error('Give the agent a name')
        return
      }
      if (!promptTouched) setPrompt(composedPrompt())
    }
    if (step === 1 && !model.trim()) {
      toast.error('Enter a model name')
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          system_prompt: prompt.trim() || composedPrompt(),
          is_active: assistantOn,
          auto_reply_enabled: autoReplyOn,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to create the agent')
      toast.success(`Agent "${name.trim()}" configured`)
      onOpenChange(false)
      setStep(0)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create the agent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-xl p-0 shadow-2xl">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span className="block h-2.5 w-2.5 shrink-0 rounded-[2px] bg-primary" aria-hidden />
            Configure New Agent
          </DialogTitle>
          <DialogDescription className="sr-only">
            Three step wizard: identity, model and prompt, triggers.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper — elevated strip for clearer visual layering */}
        <div
          className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-6 py-3.5"
          role="list"
          aria-label="Wizard steps"
        >
          {STEPS.map((label, i) => (
            <div key={label} role="listitem" className="flex items-center gap-2">
              <span
                aria-current={i === step ? 'step' : undefined}
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors',
                  i === step
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : i < step
                      ? 'bg-foreground text-background'
                      : 'border border-border bg-background text-muted-foreground',
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-sm leading-relaxed',
                  i === step ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="flex max-h-[55vh] flex-col gap-5 overflow-y-auto px-6 py-5">
          {step === 0 ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-agent-name">Agent Name</Label>
                <Input
                  id="wizard-agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Support Copilot"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-agent-purpose">Purpose / Description</Label>
                <Textarea
                  id="wizard-agent-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  rows={3}
                  placeholder="What does this agent do? What problem does it solve?"
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Agent Type:</span>
                <div className="flex flex-wrap gap-2">
                  {AGENT_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setAgentType(t.value)}
                      aria-pressed={agentType === t.value}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm leading-relaxed transition-all',
                        agentType === t.value
                          ? 'border-primary bg-primary text-primary-foreground shadow-md'
                          : 'border-border bg-card text-foreground shadow-xs hover:bg-muted hover:shadow-sm',
                      )}
                    >
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-[1px]',
                          agentType === t.value ? 'bg-primary-foreground' : 'bg-foreground',
                        )}
                        aria-hidden
                      />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">AI Provider</span>
                <div className="flex flex-wrap gap-2">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setProvider(p.value)}
                      aria-pressed={provider === p.value}
                      className={cn(
                        'rounded-lg border px-4 py-2 text-sm font-medium leading-relaxed transition-all',
                        provider === p.value
                          ? 'border-primary bg-primary text-primary-foreground shadow-md'
                          : 'border-border bg-card text-foreground shadow-xs hover:bg-muted hover:shadow-sm',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-model">Model Name</Label>
                <Input
                  id="wizard-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={`e.g. ${providerMeta.placeholder}`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-key">API Key</Label>
                <Input
                  id="wizard-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  placeholder="Paste your provider API key (kept if already saved)"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-prompt">System Prompt</Label>
                <Textarea
                  id="wizard-prompt"
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value)
                    setPromptTouched(true)
                  }}
                  rows={5}
                  className="min-h-28"
                />
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <ToggleRow
                id="wizard-assistant"
                title="AI Assistant"
                description="Drafts suggested replies for your team inside the inbox."
                checked={assistantOn}
                onCheckedChange={setAssistantOn}
              />
              <ToggleRow
                id="wizard-autoreply"
                title="AI Auto-Reply"
                description="Answers new customer messages automatically when no teammate is assigned. Escalates to a human when unsure."
                checked={autoReplyOn}
                onCheckedChange={setAutoReplyOn}
              />
              <p className="text-xs text-muted-foreground">
                Active hours, escalation handoff and the knowledge base can be tuned any time in the Configuration and Knowledge Base tabs.
              </p>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-6 py-4">
          {step === 0 ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              <ArrowLeft data-icon="inline-start" aria-hidden />
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={goNext}>
              Continue
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          ) : (
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden /> : null}
              Create Agent
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  id: string
  title: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="text-sm font-semibold text-foreground">
          {title}
        </Label>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
    </div>
  )
}
