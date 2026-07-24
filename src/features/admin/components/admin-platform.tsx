"use client";

// ============================================================
// AdminPlatform — /admin/platform (platform flags + audit trail).
//
// Two sections:
//   1. Platform settings — the `ai_engine` flag (direct vs
//      langchain), read/written through /api/admin/platform-settings.
//   2. Audit trail — keyset-paginated read of platform_audit_log
//      via /api/admin/audit (the only read surface of the table).
// ============================================================

import { useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { Bot, Loader2, ScrollText, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AiEngine = "direct" | "langchain";

interface AuditEntry {
  id: string;
  actor_id: string;
  account_id: string | null;
  action: string;
  entity: string | null;
  created_at: string;
  actor_name: string | null;
  account_name: string | null;
}

const jsonFetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Request failed");
  return body;
};

export function AdminPlatform() {
  return (
    <div className="flex flex-col gap-8">
      <EngineFlagSection />
      <AssistantConfigSection />
      <AuditTrailSection />
    </div>
  );
}

// ------------------------------------------------------------
// Platform assistant — the in-app helper agent's key + model.
// The API key belongs to the founder/support team (never tenants);
// it is sent write-only and stored encrypted. GET returns presence
// metadata only.
// ------------------------------------------------------------

type AssistantProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "nvidia"
  | "ollama"
  | "groq"
  | "mistral"
  | "deepseek"
  | "xai";

const ASSISTANT_PROVIDER_LABELS: Record<AssistantProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  nvidia: "NVIDIA (NIM)",
  ollama: "Ollama (self-hosted)",
  groq: "Groq",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  xai: "xAI (Grok)",
};

/** Ollama servers typically require no API key. */
function providerNeedsKey(p: AssistantProvider): boolean {
  return p !== "ollama";
}

/** Providers where a custom endpoint is common (self-hosted). */
function providerSupportsBaseUrl(p: AssistantProvider): boolean {
  return p === "ollama" || p === "nvidia";
}

interface AssistantConfigMeta {
  configured: boolean;
  enabled: boolean;
  provider: AssistantProvider | null;
  model: string | null;
  base_url: string | null;
  system_prompt: string | null;
  default_system_prompt: string | null;
  updated_at: string | null;
}

function AssistantConfigSection() {
  const { data, isLoading, mutate } = useSWR<AssistantConfigMeta>(
    "/api/admin/assistant-config",
    jsonFetcher,
  );
  const [provider, setProvider] = useState<AssistantProvider>("openai");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // Hydrate form once per fetched snapshot (render-time, no effect).
  const snapshot = data
    ? `${data.provider ?? ""}|${data.model ?? ""}|${data.base_url ?? ""}|${data.system_prompt ?? ""}|${data.enabled}`
    : null;
  if (data && snapshot && hydratedFor !== snapshot) {
    setHydratedFor(snapshot);
    if (data.provider) setProvider(data.provider);
    setModel(data.model ?? "");
    setBaseUrl(data.base_url ?? "");
    setSystemPrompt(data.system_prompt ?? "");
    setEnabled(data.enabled);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/assistant-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: model.trim() || undefined,
          // Write-only: omit when blank so the stored key is kept.
          api_key: apiKey.trim() || undefined,
          base_url: baseUrl.trim() || undefined,
          system_prompt: systemPrompt.trim() || undefined,
          enabled,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to save");
      setApiKey("");
      await mutate();
      toast.success("Platform assistant saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Platform assistant" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Platform assistant</h2>
        {data?.configured ? (
          <Badge variant="secondary" className="text-xs">
            {data.enabled ? "Active" : "Disabled"}
          </Badge>
        ) : null}
      </header>

      <div className="flex flex-col gap-4 rounded-lg border p-4 sm:max-w-lg">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Powers the in-app helper agent for every workspace. The key is owned
          by the founder/support team, stored encrypted, and never shown again
          after saving. Leave the key blank to keep the current one.
        </p>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="assistant-provider">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  if (typeof v === "string" && v in ASSISTANT_PROVIDER_LABELS) {
                    setProvider(v as AssistantProvider);
                  }
                }}
              >
                <SelectTrigger id="assistant-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(ASSISTANT_PROVIDER_LABELS) as AssistantProvider[]
                  ).map((p) => (
                    <SelectItem key={p} value={p}>
                      {ASSISTANT_PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="assistant-model">Model</Label>
              <Input
                id="assistant-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Provider default if blank"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="assistant-key">
                API key
                {!providerNeedsKey(provider) && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (optional for Ollama)
                  </span>
                )}
              </Label>
              <Input
                id="assistant-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  data?.configured
                    ? "•••••••• (stored)"
                    : providerNeedsKey(provider)
                      ? "sk-..."
                      : "Leave blank for open servers"
                }
                autoComplete="off"
              />
            </div>

            {providerSupportsBaseUrl(provider) && (
              <div className="grid gap-1.5">
                <Label htmlFor="assistant-base-url">
                  Server URL
                  <span className="ml-1 font-normal text-muted-foreground">
                    (self-hosted endpoint)
                  </span>
                </Label>
                <Input
                  id="assistant-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={
                    provider === "ollama"
                      ? "https://your-ollama-server.com/v1"
                      : "https://integrate.api.nvidia.com/v1"
                  }
                  autoComplete="off"
                />
              </div>
            )}

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="assistant-system-prompt">
                  System prompt
                  <span className="ml-1 font-normal text-muted-foreground">
                    (advanced)
                  </span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    setSystemPrompt(data?.default_system_prompt ?? "")
                  }
                >
                  Load default
                </Button>
              </div>
              <Textarea
                id="assistant-system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Leave blank to use the platform default persona."
                rows={7}
                className="max-h-64 min-h-32 font-mono text-xs leading-relaxed"
                maxLength={8000}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Defines the agent&apos;s persona and behavior across every
                workspace. Security rules (read-only by default,
                approval-gated writes, workspace scoping) are enforced in
                code and always appended — they cannot be overridden here.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="assistant-enabled" className="grid leading-tight">
                <span>Enabled</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Turn the helper agent on for all workspaces.
                </span>
              </Label>
              <Switch
                id="assistant-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => void save()}
                disabled={
                  saving ||
                  (!data?.configured &&
                    !apiKey.trim() &&
                    providerNeedsKey(provider))
                }
              >
                {saving && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Save assistant
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EngineFlagSection() {
  const { data, isLoading, mutate } = useSWR<{ ai_engine: AiEngine }>(
    "/api/admin/platform-settings",
    jsonFetcher,
  );
  const [saving, setSaving] = useState(false);

  async function setEngine(engine: AiEngine) {
    if (engine === data?.ai_engine) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_engine: engine }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to save setting");
      await mutate({ ai_engine: engine }, { revalidate: false });
      toast.success(`AI engine switched to ${engine}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Platform settings" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <SlidersHorizontal
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="text-sm font-semibold">Platform settings</h2>
      </header>

      <div className="flex flex-col gap-4 rounded-lg border p-4 sm:max-w-lg">
        <div className="grid leading-tight">
          <span className="text-sm font-medium">AI engine</span>
          <span className="text-xs text-muted-foreground">
            Which execution engine powers AI features platform-wide. Other
            instances converge within ~30 seconds.
          </span>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <RadioGroup
            value={data?.ai_engine ?? "direct"}
            onValueChange={(v) => {
              if (v === "direct" || v === "langchain") void setEngine(v);
            }}
            className="flex flex-col gap-3"
            aria-label="AI engine"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="direct"
                id="engine-direct"
                disabled={saving}
              />
              <Label htmlFor="engine-direct" className="grid leading-tight">
                <span>Direct</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Calls model providers directly through the AI SDK.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="langchain"
                id="engine-langchain"
                disabled={saving}
              />
              <Label htmlFor="engine-langchain" className="grid leading-tight">
                <span>LangChain</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Routes AI workloads through the LangChain pipeline.
                </span>
              </Label>
            </div>
          </RadioGroup>
        )}

        {saving && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Saving…
          </p>
        )}
      </div>
    </section>
  );
}

function AuditTrailSection() {
  const { data, isLoading, isValidating, size, setSize } = useSWRInfinite<{
    entries: AuditEntry[];
    next_cursor: string | null;
  }>((index, previous) => {
    if (previous && !previous.next_cursor) return null;
    const p = new URLSearchParams();
    if (index > 0 && previous?.next_cursor) {
      p.set("cursor", previous.next_cursor);
    }
    const s = p.toString();
    return `/api/admin/audit${s ? `?${s}` : ""}`;
  }, jsonFetcher);

  const entries = (data ?? []).flatMap((p) => p.entries);
  const nextCursor = data?.[data.length - 1]?.next_cursor ?? null;
  const loading = isLoading || isValidating;

  return (
    <section aria-label="Audit trail" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <ScrollText
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="text-sm font-semibold">Audit trail</h2>
      </header>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && entries.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No audit entries yet. Super-admin mutations will appear
                  here.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{e.actor_name ?? "Unknown"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.account_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {e.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-52 truncate font-mono text-xs text-muted-foreground">
                    {e.entity ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void setSize(size + 1)}
          >
            {loading && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}
