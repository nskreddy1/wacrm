"use client";

// ============================================================
// AdminAiAgent — /admin/ai-agent (per-tenant bot provisioning).
//
// Enterprise settings layout: a sticky context bar (workspace
// picker + live status) above stacked settings sections, each in
// the "label rail left / controls right" pattern used by serious
// ops consoles. Sections: Connection, Persona, Behaviour and a
// visually isolated Danger zone. Exactly the options the
// workspace's own Settings → AI form exposes, so whatever the
// super admin provisions here is what the customer sees.
// ============================================================

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  type LucideIcon,
  Bot,
  Building2,
  KeyRound,
  Loader2,
  MessageSquareText,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { AI_PROVIDERS, type AiProvider } from "@/features/assistant/lib/ai/types";
import { AI_PROVIDER_DEFAULT_MODEL } from "@/features/assistant/lib/ai/defaults";

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  nvidia: "NVIDIA NIM",
  groq: "Groq",
  openrouter: "OpenRouter",
  together: "Together AI",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  xai: "xAI",
  ollama: "Ollama (self-hosted)",
  custom: "Custom (OpenAI-compatible)",
};

interface MemberOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
  account_role: string;
}

interface AiConfigResponse {
  configured: boolean;
  has_key?: boolean;
  members: MemberOption[];
  provider?: AiProvider;
  model?: string;
  base_url?: string | null;
  system_prompt?: string | null;
  is_active?: boolean;
  auto_reply_enabled?: boolean;
  auto_reply_max_per_conversation?: number;
  handoff_agent_id?: string | null;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

const jsonFetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Request failed");
  return body;
};

export function AdminAiAgent() {
  const [accountId, setAccountId] = useState<string | null>(null);

  const { data: wsData, isLoading: wsLoading } = useSWR<{
    workspaces: WorkspaceOption[];
  }>("/api/admin/workspaces", jsonFetcher);
  const workspaces = wsData?.workspaces ?? [];
  const activeWorkspace = workspaces.find((w) => w.id === accountId);

  const {
    data: config,
    isLoading: configLoading,
    mutate,
  } = useSWR<AiConfigResponse>(
    accountId ? `/api/admin/ai-config?account_id=${accountId}` : null,
    jsonFetcher,
  );

  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-6"
      aria-label="AI agent provisioning"
    >
      {/* Context bar: which tenant are we operating on + live status */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <Building2
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label
              htmlFor="ai-workspace"
              className="text-xs text-muted-foreground"
            >
              Operating on workspace
            </Label>
            <Select
              items={Object.fromEntries(workspaces.map((w) => [w.id, w.name]))}
              value={accountId}
              onValueChange={(v) => {
                if (v !== null) setAccountId(v);
              }}
            >
              <SelectTrigger
                id="ai-workspace"
                aria-label="Select workspace"
                className="h-8 w-full min-w-56 sm:w-72"
              >
                <SelectValue
                  placeholder={
                    wsLoading ? "Loading workspaces…" : "Select a workspace…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {accountId && config && (
          <StatusPill
            configured={config.configured}
            active={config.is_active ?? false}
            autoReply={config.auto_reply_enabled ?? false}
          />
        )}
      </div>

      {!accountId ? (
        <EmptyState />
      ) : configLoading || !config ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <AgentForm
          key={accountId}
          accountId={accountId}
          workspaceName={activeWorkspace?.name ?? "this workspace"}
          config={config}
          onSaved={() => void mutate()}
        />
      )}
    </section>
  );
}

function StatusPill({
  configured,
  active,
  autoReply,
}: {
  configured: boolean;
  active: boolean;
  autoReply: boolean;
}) {
  if (!configured) {
    return (
      <Badge variant="outline" className="shrink-0 gap-1.5">
        <span
          className="size-1.5 rounded-full bg-muted-foreground"
          aria-hidden="true"
        />
        Not provisioned
      </Badge>
    );
  }
  if (!active) {
    return (
      <Badge variant="secondary" className="shrink-0 gap-1.5">
        <span
          className="size-1.5 rounded-full bg-muted-foreground"
          aria-hidden="true"
        />
        Provisioned · off
      </Badge>
    );
  }
  return (
    <Badge className="shrink-0 gap-1.5">
      <span
        className="size-1.5 animate-pulse rounded-full bg-primary-foreground"
        aria-hidden="true"
      />
      {autoReply ? "Live · auto-reply on" : "Live · drafts only"}
    </Badge>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full border bg-muted">
        <Bot className="size-7 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <h3 className="text-sm font-semibold">Provision an AI agent</h3>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          Pick a workspace above to set up its WhatsApp bot for the customer —
          provider and model, encrypted API key, system prompt, auto-reply
          behaviour and human handoff. They&apos;ll see the same configuration
          in their own Settings.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- */
/* Settings section: label rail on the left, controls right.   */
/* ---------------------------------------------------------- */

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[220px_1fr] md:gap-10">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
          {description}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}

function AgentForm({
  accountId,
  workspaceName,
  config,
  onSaved,
}: {
  accountId: string;
  workspaceName: string;
  config: AiConfigResponse;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<AiProvider>(
    config.provider ?? "gemini",
  );
  const [model, setModel] = useState(
    config.model ?? AI_PROVIDER_DEFAULT_MODEL[config.provider ?? "gemini"],
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(config.base_url ?? "");
  const [systemPrompt, setSystemPrompt] = useState(config.system_prompt ?? "");
  // Unprovisioned workspace → default the switches ON so a validated
  // first save goes live immediately (the backend tests the key with
  // the provider before persisting). Existing configs keep their
  // stored values.
  const [isActive, setIsActive] = useState(
    config.configured ? (config.is_active ?? false) : true,
  );
  const [autoReply, setAutoReply] = useState(
    config.configured ? (config.auto_reply_enabled ?? false) : true,
  );
  const [maxPer, setMaxPer] = useState(
    String(config.auto_reply_max_per_conversation ?? 3),
  );
  const [handoff, setHandoff] = useState<string>(
    config.handoff_agent_id ?? "unassigned",
  );
  const [saving, setSaving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Switching provider pre-fills its sensible default model — but only
  // when the field still holds the previous provider's default, so a
  // hand-edited model id is never clobbered.
  useEffect(() => {
    setModel((current) => {
      const defaults = Object.values(AI_PROVIDER_DEFAULT_MODEL);
      return current === "" || defaults.includes(current)
        ? AI_PROVIDER_DEFAULT_MODEL[provider]
        : current;
    });
  }, [provider]);

  const needsBaseUrl = provider === "custom" || provider === "ollama";
  const keyOptional = provider === "ollama";

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          provider,
          model,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          base_url: needsBaseUrl ? baseUrl : null,
          system_prompt: systemPrompt,
          is_active: isActive,
          auto_reply_enabled: autoReply,
          auto_reply_max_per_conversation: Number(maxPer),
          handoff_agent_id: handoff === "unassigned" ? "" : handoff,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to save");
      toast.success(
        config.configured
          ? "AI agent updated"
          : "AI agent provisioned for the workspace",
      );
      setApiKey("");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/ai-config?account_id=${accountId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to remove");
      toast.success("AI agent removed — bot is off and the key was forgotten");
      setRemoveOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {/* ------------------- Connection ------------------- */}
        <SettingsSection
          icon={KeyRound}
          title="Connection"
          description="Which LLM answers on behalf of this workspace. The key is validated with the provider, encrypted at rest and never shown again."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-provider">Provider</Label>
              <Select
                items={PROVIDER_LABEL}
                value={provider}
                onValueChange={(v) => {
                  if (v !== null) setProvider(v as AiProvider);
                }}
              >
                <SelectTrigger
                  id="agent-provider"
                  aria-label="Select AI provider"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-model">Model</Label>
              <Input
                id="agent-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                autoComplete="off"
                className="font-mono text-sm"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="agent-key">API key</Label>
              {config.has_key ? (
                <Badge variant="secondary" className="text-xs font-normal">
                  Key stored
                </Badge>
              ) : keyOptional ? (
                <span className="text-xs text-muted-foreground">
                  Optional for Ollama
                </span>
              ) : null}
            </div>
            <Input
              id="agent-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                config.has_key
                  ? "•••••••••••• — leave blank to keep the stored key"
                  : "Provider API key"
              }
              autoComplete="new-password"
              className="font-mono text-sm"
              required={!config.has_key && !keyOptional}
            />
          </div>

          {needsBaseUrl && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-base-url">
                Base URL{" "}
                {provider === "ollama" && (
                  <span className="font-normal text-muted-foreground">
                    (optional — defaults to the local daemon)
                  </span>
                )}
              </Label>
              <Input
                id="agent-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  provider === "ollama"
                    ? "http://localhost:11434/v1"
                    : "https://api.example.com/v1"
                }
                autoComplete="off"
                className="font-mono text-sm"
                required={provider === "custom"}
              />
            </div>
          )}
        </SettingsSection>

        <Separator />

        {/* -------------------- Persona --------------------- */}
        <SettingsSection
          icon={MessageSquareText}
          title="Persona"
          description="Business context, tone and facts for the bot. Appended to a fixed safety scaffold — it can shape voice, never disable the guardrails."
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-prompt">System prompt</Label>
            <Textarea
              id="agent-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={8}
              className="min-h-40 leading-relaxed"
              placeholder={
                "You represent Acme Fashions, a clothing store in Hyderabad.\n" +
                "Store hours 10am–9pm. Free delivery above ₹999.\n" +
                "Be warm and concise; escalate order-status questions to a human."
              }
            />
            <p className="text-xs text-muted-foreground">
              {systemPrompt.length > 0
                ? `${systemPrompt.length.toLocaleString()} characters`
                : "Tip: include who the business is, hours, policies, and when to hand off."}
            </p>
          </div>
        </SettingsSection>

        <Separator />

        {/* ------------------- Behaviour -------------------- */}
        <SettingsSection
          icon={SlidersHorizontal}
          title="Behaviour"
          description="How the agent participates in the inbox — from suggested drafts only to fully autonomous replies with a human-handoff safety valve."
        >
          <div className="flex flex-col divide-y rounded-lg border">
            <label className="flex items-center justify-between gap-4 p-3.5 text-sm">
              <span className="grid gap-0.5 leading-tight">
                <span className="font-medium">Assistant enabled</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Master switch — off means no drafts and no auto-replies.
                </span>
              </span>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                aria-label="Toggle assistant"
              />
            </label>

            <label className="flex items-center justify-between gap-4 p-3.5 text-sm">
              <span className="grid gap-0.5 leading-tight">
                <span className="font-medium">Auto-reply to customers</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Bot answers incoming WhatsApp messages with no human in the
                  loop.
                </span>
              </span>
              <Switch
                checked={autoReply}
                onCheckedChange={setAutoReply}
                aria-label="Toggle auto-reply"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-max-per">
                Max auto-replies / conversation
              </Label>
              <Input
                id="agent-max-per"
                type="number"
                min={1}
                max={20}
                value={maxPer}
                onChange={(e) => setMaxPer(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                After this, the bot goes quiet and hands off.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-handoff">Handoff assignee</Label>
              <Select
                items={{
                  unassigned: "Unassigned (shared queue)",
                  ...Object.fromEntries(
                    config.members.map((m) => [
                      m.user_id,
                      `${m.full_name || m.email || m.user_id} (${m.account_role})`,
                    ]),
                  ),
                }}
                value={handoff}
                onValueChange={(v) => {
                  if (v !== null) setHandoff(v);
                }}
              >
                <SelectTrigger id="agent-handoff" aria-label="Handoff assignee">
                  <SelectValue placeholder="Unassigned (shared queue)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">
                    Unassigned (shared queue)
                  </SelectItem>
                  {config.members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email || m.user_id} ({m.account_role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Who picks up when a customer asks for a human.
              </p>
            </div>
          </div>
        </SettingsSection>

        {/* ------------------ Sticky save bar ---------------- */}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-card/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-6">
          <p className="hidden text-xs text-muted-foreground sm:block">
            Changes apply to{" "}
            <span className="font-medium text-foreground">
              {workspaceName}
            </span>{" "}
            immediately and are recorded in the audit trail.
          </p>
          <Button type="submit" disabled={saving} className="min-w-36">
            {saving && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {config.configured ? "Save changes" : "Provision agent"}
          </Button>
        </div>
      </div>

      {/* ------------------- Danger zone -------------------- */}
      {config.configured && (
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="grid gap-0.5 leading-tight">
              <h3 className="text-sm font-semibold">Remove AI agent</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Turns the bot off immediately and deletes the stored API key.
                The workspace can be re-provisioned at any time.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={removing}
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove agent
          </Button>
        </div>
      )}

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this workspace&apos;s AI agent?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The bot turns off immediately and the stored API key is deleted.
              The workspace can be re-provisioned at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {removing && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              Remove agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
