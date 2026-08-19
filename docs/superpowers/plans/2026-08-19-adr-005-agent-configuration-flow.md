# AI Agent Configuration Flow (ADR-005) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-run agent setup shows a real, provider-verified model list (provider → key → model order everywhere), and "is this agent usable" has exactly one definition so the Playground banner, console rail and inbox banner can never disagree.

**Architecture:** Add `POST` beside the untouched `GET` on `/api/ai/models` and `/api/admin/ai-models`, sharing one handler body so the auth guard cannot drift between verbs (F2). The key travels in the JSON body only (never a URL), is never persisted, logged or echoed (F1). Client-side, `ModelPicker` gains a `draftApiKey` prop with a ~600ms debounce and a fingerprinted SWR key. Status logic collapses into two helpers in `agent-meta.ts` that every surface imports. No database migration (D10).

**Tech Stack:** Next.js 16 route handlers, SWR, Vitest, existing `requireRole`/`requireSuperAdmin` guards, `checkRateLimit` (Redis-backed per ADR-005 F6), `listProviderModels` catalog.

## Global Constraints

- Security findings **F1–F6 in ADR-005 are binding**; do not relax them for convenience.
- The API key MUST NOT appear in: a query string, a log line, a response body, or a raw SWR cache key. Fingerprint = `${key.length}:${key.slice(-4)}`.
- `GET` behaviour on both routes is **frozen** — every existing caller must be unaffected.
- The model field stays typeable in every state (D4). Only `code === 'invalid_key'` blocks the wizard's Continue; all other error codes warn and allow.
- The listing routes keep the non-throwing contract: `200 { models, needsKey, error?, code? }` — never a 500 on a provider problem.
- Every task: `pnpm typecheck && pnpm test` green before commit. Feature branch, no pushes to main.

## File Structure

- Create: `src/features/assistant/lib/ai/list-models.ts` (Task 1 — shared handler body)
- Modify: `src/app/api/ai/models/route.ts`, `src/app/api/admin/ai-models/route.ts` (Task 1)
- Modify: `src/features/agents/lib/agent-meta.ts` (Task 2 — D8 helpers)
- Modify: `src/features/assistant/components/model-picker.tsx` (Task 3)
- Modify: `src/features/agents/components/agent-setup-wizard.tsx` (Task 4)
- Modify: `src/features/agents/components/agent-settings-form.tsx`, `src/features/admin/components/admin-ai-agent.tsx` (Task 5)
- Modify: `src/features/agents/components/ai-playground.tsx`, `agents-console.tsx`, inbox banner consumer (Task 6)
- Create/Modify tests beside each file (Tasks 1–6); Modify: `.agents/context/api-routes.md`, ADR-005 status (Task 7)

---

### Task 1: Shared listing handler + `POST` on both routes (D2, D5, F1, F2, F4)

**Files:**
- Create: `src/features/assistant/lib/ai/list-models.ts`
- Modify: `src/app/api/ai/models/route.ts`
- Modify: `src/app/api/admin/ai-models/route.ts`

**Steps:**
- [ ] Extract the current `GET` body of `/api/ai/models` into a shared function
      `handleListModels({ supabase, accountId, provider, baseUrl, bodyApiKey? })`
      in `list-models.ts`. Key resolution order: `bodyApiKey` if non-empty,
      else stored key decrypted from the agent row (exact current logic,
      including the decrypt-failure `needsKey` message and the
      `ollama`-needs-no-key path).
- [ ] `GET` on both routes delegates to the shared function with
      `bodyApiKey: undefined` — behaviour byte-for-byte identical to today.
- [ ] Add `POST` on `/api/ai/models`: `requireRole('admin')` +
      `checkRateLimit('ai-models:${userId}', RATE_LIMITS.adminAction)` (the
      SAME key as `GET`, so the two verbs share one budget), parse
      `{ provider, api_key?, base_url? }` from the JSON body, validate
      `isAiProvider(provider)`, delegate to the shared function.
- [ ] Add `POST` on `/api/admin/ai-models`: `requireSuperAdmin()` + required
      `account_id` in the body, same shared function.
- [ ] F1 checks in code review: no `console.*` of the body anywhere in the
      path; the response object never includes `api_key`; the key variable is
      function-local and not stored.
- [ ] `AiError` mapping unchanged: `code` propagated verbatim (F4);
      unknown errors answer `200` with a generic `error` and no `code`.

**Verification:** existing `GET` tests still pass unmodified.

---

### Task 2: `isAgentConfigured` / `isAutoReplyLive` helpers (D8)

**Files:**
- Modify: `src/features/agents/lib/agent-meta.ts` (+ its test file)

**Steps:**
- [ ] `isAgentConfigured(agent: ClientAgent | null | undefined): boolean` =
      `Boolean(agent?.provider && agent?.model && (agent?.hasApiKey || agent?.provider === 'ollama'))`
      — the `ai-playground.tsx:38` definition, which is the strictest and
      correct one (the console's `provider && model` at `:88`/`:477` is the
      documented drift being fixed).
- [ ] `isAutoReplyLive(agent)` = configured AND `isEnabled` AND
      `autoreplyEnabled` (lift the exact boolean from `fetchAgentStatus`).
- [ ] Unit tests: null agent; provider+model but no key → NOT configured;
      ollama without key → configured; configured but disabled → not live.

---

### Task 3: `ModelPicker` key-first listing (D2, D7, F1, F3)

**Files:**
- Modify: `src/features/assistant/components/model-picker.tsx` (+ tests)

**Steps:**
- [ ] New props: `draftApiKey?: string`, `onListState?: (s: { status: 'idle'|'loading'|'ok'|'error'; code?: string }) => void`.
- [ ] When `draftApiKey` is present and ≥ ~20 chars, fetch via `POST` with a
      **~600ms debounce**; otherwise keep today's `GET` path untouched.
- [ ] SWR key MUST be a fingerprint: `['ai-models', provider, baseUrl, `${draftApiKey.length}:${draftApiKey.slice(-4)}`]`.
      The raw key travels only in the fetcher's request body (F1).
- [ ] Provider change clears the selected model (D7). Pre-select
      `PROVIDER_PRESETS.defaultModel` ONLY if that id is present in the
      returned list; otherwise select nothing.
- [ ] The field remains typeable in every state (D4) — the list is a
      convenience, never a gate.
- [ ] Tests advance fake timers past the debounce before asserting a fetch.

---

### Task 4: Wizard → 4 steps with the `invalid_key`-only gate (D3, D4, D6, D7)

**Files:**
- Modify: `src/features/agents/components/agent-setup-wizard.tsx` (+ tests)

**Steps:**
- [ ] Steps: **1. Provider + Key** (and base URL for `custom`/`ollama`, with
      inline verification state from `onListState`) → **2. Model** (list
      fetched with the just-entered key) → **3. Personality** → **4. Review**.
- [ ] Step 1 Continue blocks **only** on `code === 'invalid_key'`. `timeout`,
      `network_error`, `rate_limited`, `not_supported`, `bad_response`,
      `provider_error` render a warning and allow Continue (D4).
- [ ] Loading the list IS the verification (D3) — no separate verify call;
      server-side verification in `POST /api/ai/agents` is unchanged (F5).

---

### Task 5: Key-above-model on both settings surfaces (D1, D5)

**Files:**
- Modify: `src/features/agents/components/agent-settings-form.tsx`
- Modify: `src/features/admin/components/admin-ai-agent.tsx`

**Steps:**
- [ ] Reorder fields: provider → API key → model on both surfaces.
- [ ] Pass the in-progress key as `draftApiKey` to the shared `ModelPicker`
      so switching provider + pasting a new key lists models before save.
- [ ] Admin surface targets `/api/admin/ai-models` `POST` with explicit
      `account_id` (F2).

---

### Task 6: One status definition everywhere (D8, D9 — the Defect 2 fix)

**Files:**
- Modify: `src/features/agents/components/ai-playground.tsx`
- Modify: `src/features/agents/components/agents-console.tsx`
- Modify: the inbox auto-reply banner consumer

**Steps:**
- [ ] Playground: delete `fetchAgentStatus` and the local `AgentStatus`
      interface; use `useSWR<{ agent: ClientAgent | null }>('/api/ai/agents', swrJson)` —
      same key AND same fetcher as the console — and derive
      `isSetUp = isAgentConfigured(data?.agent)`.
- [ ] Console: replace both `Boolean(agent?.provider && agent?.model)` sites
      (`:88`, `:477`) with `isAgentConfigured(agent)` — this corrects the
      "Paused vs Not configured" mislabel for key-less agents.
- [ ] Inbox banner: derive from `isAutoReplyLive` where it currently
      recomputes.
- [ ] Manual check: configure an agent fully → Playground tab no longer says
      "Your agent isn't set up yet."

---

### Task 7: Route tests, docs, ADR closeout

**Steps:**
- [ ] Route tests (Vitest): `POST` lists with no stored agent row; empty
      `api_key` falls back to the stored key exactly as `GET`; provider 401 →
      `200 { code: 'invalid_key' }`; the key string never appears anywhere in
      the serialized response; `POST` without auth is rejected on both routes;
      rate limit answers 429 with headers.
- [ ] Record the two new `POST` verbs in `.agents/context/api-routes.md`;
      run `pnpm docs:sync`.
- [ ] Flip ADR-005 status Accepted → Implemented; check off its action items.
- [ ] `pnpm check` green; browser-verify the wizard first-run flow end to end.

---

## Risks / notes

- The classic failure this plan guards against is a `POST` added without the
  guard `GET` has — the shared handler (Task 1) exists specifically so the
  guard lives once. Any future edit that un-shares the handler re-opens F2.
- Rate limiting behind these routes is Upstash-backed with a bounded
  in-memory degradation mode (ADR-005 F6) — no action needed here, and no
  cost exposure at current scale.
