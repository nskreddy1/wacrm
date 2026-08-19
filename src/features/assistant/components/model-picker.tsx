'use client';

// ============================================================
// ModelPicker — combobox over the provider's LIVE model list.
//
// Shared by the tenant agent form and the super-admin console (they
// differ only in which endpoint holds the key), which is why it lives
// in the assistant feature: both `agents` and `admin` are allowed to
// import from here.
//
// Two rules shape the design:
//
//  1. It stays a TEXT FIELD. The list is a convenience, never a gate —
//     a model released this morning, a private deployment name, or a
//     provider whose listing endpoint is down must all remain typeable.
//     Anything else would make our bundle's freshness a hard dependency
//     of a customer being able to configure their own account.
//  2. Reasoning capability is shown here, at the point of choice,
//     because it decides whether the "Think before replying" switch
//     below is even rendered. Picking `gpt-4o` and wondering where the
//     switch went is the confusion this badge prevents.
// ============================================================

import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { Brain, ChevronsUpDown, Loader2, RefreshCw } from 'lucide-react';

import type { CatalogModel } from '@/features/assistant/lib/ai/model-catalog';
import type { AiProvider } from '@/features/assistant/lib/ai/types';

interface ModelsResponse {
  models: CatalogModel[];
  needsKey: boolean;
  error?: string;
  code?: string;
}

const fetcher = async (url: string): Promise<ModelsResponse> => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? 'Could not load models');
  }
  return body as ModelsResponse;
};

interface ModelPickerProps {
  id: string;
  provider: AiProvider;
  value: string;
  onChange: (model: string) => void;
  /** Which listing route to use — the tenant one reads the account's
   *  own key, the admin one reads the target workspace's. */
  endpoint?: '/api/ai/models' | '/api/admin/ai-models';
  /** Super-admin console: whose models to list. */
  accountId?: string;
  /** In-progress base URL for custom / ollama endpoints. */
  baseUrl?: string | null;
  disabled?: boolean;
}

export function ModelPicker({
  id,
  provider,
  value,
  onChange,
  endpoint = '/api/ai/models',
  accountId,
  baseUrl,
  disabled,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const params = new URLSearchParams({ provider });
  if (accountId) params.set('account_id', accountId);
  if (baseUrl && (provider === 'custom' || provider === 'ollama')) {
    params.set('base_url', baseUrl);
  }
  // `custom` cannot be listed without an endpoint, so don't even ask.
  const shouldFetch =
    !disabled && !(provider === 'custom' && !baseUrl?.trim());

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<ModelsResponse>(
      shouldFetch ? `${endpoint}?${params.toString()}` : null,
      fetcher,
      { revalidateOnFocus: false, keepPreviousData: false }
    );

  const models = data?.models ?? [];
  // While the field is untouched the list is unfiltered; typing filters
  // it, so the control reads as a text input that happens to suggest.
  const filter = (query ?? '').trim().toLowerCase();
  const shown = useMemo(() => {
    const list = filter
      ? models.filter(
          (m) =>
            m.id.toLowerCase().includes(filter) ||
            m.label.toLowerCase().includes(filter)
        )
      : models;
    return list.slice(0, 60);
  }, [models, filter]);

  const selected = models.find((m) => m.id === value);
  const listboxId = `${id}-listbox`;

  const commit = (next: string) => {
    onChange(next);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className="relative flex flex-col gap-1.5">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query ?? value}
          placeholder="Model id"
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on an option land before the list unmounts.
            blurTimer.current = setTimeout(() => {
              setOpen(false);
              setQuery(null);
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery(null);
            }
            if (e.key === 'ArrowDown') setOpen(true);
            // Enter on a single remaining match is the fast path.
            if (e.key === 'Enter' && open && shown.length === 1) {
              e.preventDefault();
              commit(shown[0].id);
            }
          }}
          className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 pr-9 font-mono text-sm disabled:opacity-50"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show available models"
          disabled={disabled}
          onMouseDown={(e) => {
            // mousedown, not click: the input's blur would otherwise
            // close the list before the click ever fires.
            e.preventDefault();
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen((v) => !v);
          }}
          className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-9 items-center justify-center"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ChevronsUpDown className="size-4" aria-hidden />
          )}
        </button>

        {open && (models.length > 0 || isLoading) ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Available models"
            className="border-border bg-popover absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border p-1 shadow-md"
          >
            {isLoading ? (
              <li className="text-muted-foreground px-2 py-1.5 text-xs">
                Loading models…
              </li>
            ) : shown.length === 0 ? (
              <li className="text-muted-foreground px-2 py-1.5 text-xs">
                No match — press Enter to use what you typed.
              </li>
            ) : (
              shown.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={m.id === value}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (blurTimer.current) clearTimeout(blurTimer.current);
                      commit(m.id);
                    }}
                    className={
                      m.id === value
                        ? 'bg-accent text-accent-foreground flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left'
                        : 'hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left'
                    }
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-xs">{m.id}</span>
                      {m.label !== m.id ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {m.label}
                        </span>
                      ) : null}
                    </span>
                    {m.reasoning ? (
                      <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                        <Brain className="size-3" aria-hidden />
                        Thinking
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <ModelHint
        provider={provider}
        needsKey={data?.needsKey ?? false}
        count={models.length}
        selected={selected}
        loadError={
          error instanceof Error ? error.message : (data?.error ?? null)
        }
        refreshing={isValidating && !isLoading}
        onRefresh={shouldFetch ? () => void mutate() : null}
      />
    </div>
  );
}

/** One line of context under the field: how the list was obtained, or
 *  why it is empty. Never an error state — the field still works. */
function ModelHint({
  provider,
  needsKey,
  count,
  selected,
  loadError,
  refreshing,
  onRefresh,
}: {
  provider: AiProvider;
  needsKey: boolean;
  count: number;
  selected?: CatalogModel;
  loadError: string | null;
  refreshing: boolean;
  onRefresh: (() => void) | null;
}) {
  let message: string;
  if (needsKey) {
    message =
      provider === 'custom'
        ? 'Enter the endpoint and key, then save — the model list loads from the endpoint afterwards.'
        : 'Save an API key for this provider to load its model list. You can type the model id in the meantime.';
  } else if (loadError) {
    message = `${loadError} You can still type the model id.`;
  } else if (count > 0) {
    message = `${count} model${count === 1 ? '' : 's'} available on this key${
      selected?.reasoning ? ' · this one supports thinking' : ''
    }.`;
  } else {
    message = 'Type the exact model id from your provider.';
  }

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1">{message}</span>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="hover:text-foreground flex shrink-0 items-center gap-1"
        >
          <RefreshCw
            className={refreshing ? 'size-3 animate-spin' : 'size-3'}
            aria-hidden
          />
          Refresh
        </button>
      ) : null}
    </p>
  );
}
