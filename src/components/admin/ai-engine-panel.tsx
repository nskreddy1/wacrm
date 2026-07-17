'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Cpu, Sparkles } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ============================================================
// AI engine panel — the super-admin switch between the direct
// fetch adapters and the LangChain engine. Backed by
// GET/PATCH /api/admin/platform-settings; the flag applies
// platform-wide (chat generation AND embeddings, every workspace).
// ============================================================

type AiEngine = 'direct' | 'langchain';

const ENGINES: Array<{
  value: AiEngine;
  label: string;
  description: string;
  icon: typeof Cpu;
}> = [
  {
    value: 'direct',
    label: 'Direct',
    description:
      'Provider APIs called through the built-in fetch adapters. The default, battle-tested path.',
    icon: Cpu,
  },
  {
    value: 'langchain',
    label: 'LangChain',
    description:
      'Routes generation and embeddings through the LangChain engine for advanced orchestration.',
    icon: Sparkles,
  },
];

const fetcher = async (url: string): Promise<{ ai_engine: AiEngine }> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
};

export function AiEnginePanel() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/admin/platform-settings',
    fetcher,
    { revalidateOnFocus: false },
  );
  const [saving, setSaving] = useState(false);

  const current = data?.ai_engine;

  const select = async (engine: AiEngine) => {
    if (saving || engine === current) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_engine: engine }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await mutate(body, { revalidate: false });
      toast.success(
        `AI engine switched to ${engine === 'direct' ? 'Direct' : 'LangChain'}`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to switch AI engine',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>AI Engine</CardTitle>
          {current ? (
            <Badge variant="secondary" className="capitalize">
              {current}
            </Badge>
          ) : null}
        </div>
        <CardDescription className="text-pretty">
          Which engine serves AI chat generation and embeddings across the
          whole platform. Other server instances converge within ~30 seconds.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : 'Failed to load the current engine.'}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="AI engine"
            className="flex flex-col gap-3"
          >
            {ENGINES.map(({ value, label, description, icon: Icon }) => {
              const active = value === current;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={saving}
                  onClick={() => select(value)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent',
                    saving && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Icon
                    className={cn(
                      'mt-0.5 h-5 w-5 shrink-0',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {label}
                      {active ? (
                        <Badge className="h-5 px-1.5 text-[11px]">
                          Active
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
