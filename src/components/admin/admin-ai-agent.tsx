"use client";

// ============================================================
// AdminAiAgent — /admin/ai-agent (per-tenant bot provisioning).
//
// The onboarding companion to /admin/channels: pick a workspace,
// then set up its AI agent FOR the customer — provider, model,
// API key (write-only, encrypted server-side), system prompt,
// auto-reply behaviour and human-handoff routing. Exactly the
// options the workspace's own Settings → AI form exposes, so
// whatever the super admin provisions here is what the customer
// sees (and can later tweak) in their own settings.
// ============================================================

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bot, Loader2, Trash2 } from "lucide-react";

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

import { AI_PROVIDERS, type AiProvider } from "@/lib/ai/types";
import { AI_PROVIDER_DEFAULT_MODEL } from "@/lib/ai/defaults";

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

  const {
    data: config,
    isLoading: configLoading,
    mutate,
  } = useSWR<AiConfigResponse>(
    accountId ? `/api/admin/ai-config?account_id=${accountId}` : null,
    jsonFetcher,
  );

  return (
    <section className="flex flex-col gap-4" aria-label="AI agent provisioning">
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="ai-workspace">Workspace</Label>
        <Select
          items={Object.fromEntries(workspaces.map((w) => [w.id, w.name]))}
          value={accountId}
          onValueChange={(v) => {
            if (v !== null) setAccountId(v);
          }}
        >
          <SelectTrigger id="ai-workspace" aria-label="Select workspace">
            <SelectValue placeholder="Select a workspace…" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {wsLoading && (
          <p className="text-xs text-muted-foreground">Loading workspaces…</p>
        )}
      </div>

      {!accountId ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Select a workspace to provision or edit its AI agent — provider,
          model, system prompt and auto-reply behaviour.
        </p>
      ) : configLoading || !config ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : (
        <AgentForm
          key={accountId}
          accountId={accountId}
          config={config}
          onSaved={() => void mutate()}
        />
      )}
    </section>
  );
}

function AgentForm({
  accountId,
  config,
  onSaved,
}: {
  accountId: string;
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
  const [isActive, setIsActive] = useState(config.is_active ?? false);
  const [autoReply, setAutoReply] = useState(
    config.auto_reply_enabled ?? false,
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
      const res = await fetch(
        `/api/admin/ai-config?account_id=${accountId}`,
        { method: "DELETE" },
      );
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
      className="flex max-w-2xl flex-col gap-5 rounded-lg border p-4 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-primary" aria-hidden="true" />
          <div className="grid leading-tight">
            <h3 className="text-sm font-semibold">AI agent</h3>
            <p className="text-xs text-muted-foreground">
              Draft replies and auto-reply bot for this workspace&apos;s inbox.
            </p>
          </div>
        </div>
        {config.configured ? (
          <Badge variant={config.is_active ? "default" : "secondary"}>
            {config.is_active ? "Active" : "Configured (off)"}
          </Badge>
        ) : (
          <Badge variant="outline">Not configured</Badge>
        )}
      </header>

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
            <SelectTrigger id="agent-provider" aria-label="Select AI provider">
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
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-key">
          API key{" "}
          {config.has_key ? (
            <span className="font-normal text-muted-foreground">
              (stored — leave blank to keep)
            </span>
          ) : keyOptional ? (
            <span className="font-normal text-muted-foreground">
              (optional for Ollama)
            </span>
          ) : null}
        </Label>
        <Input
          id="agent-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={config.has_key ? "••••••••••••" : "Provider API key"}
          autoComplete="new-password"
          required={!config.has_key && !keyOptional}
        />
        <p className="text-xs text-muted-foreground">
          Validated with the provider before saving, then encrypted at rest.
          Never shown again.
        </p>
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
            required={provider === "custom"}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-prompt">System prompt</Label>
        <Textarea
          id="agent-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder={
            "Business context, persona and tone for the bot. Example:\n" +
            "You represent Acme Fashions, a clothing store in Hyderabad. " +
            "Store hours 10am–9pm. Free delivery above ₹999. " +
            "Be warm and concise; escalate order-status questions to a human."
          }
        />
        <p className="text-xs text-muted-foreground">
          Appended to a fixed safety scaffold — it can shape tone and facts,
          but cannot disable the built-in guardrails.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          Behaviour
        </legend>

        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="grid leading-tight">
            Assistant enabled
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

        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="grid leading-tight">
            Auto-reply to customers
            <span className="text-xs font-normal text-muted-foreground">
              Bot answers incoming WhatsApp messages with no human in the loop.
            </span>
          </span>
          <Switch
            checked={autoReply}
            onCheckedChange={setAutoReply}
            aria-label="Toggle auto-reply"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-max-per">Max auto-replies / conversation</Label>
            <Input
              id="agent-max-per"
              type="number"
              min={1}
              max={20}
              value={maxPer}
              onChange={(e) => setMaxPer(e.target.value)}
            />
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
          </div>
        </div>
      </fieldset>

      <footer className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          {config.configured ? "Save changes" : "Provision agent"}
        </Button>
        {config.configured && (
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
            disabled={removing}
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove agent
          </Button>
        )}
      </footer>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this workspace&apos;s AI agent?</AlertDialogTitle>
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
