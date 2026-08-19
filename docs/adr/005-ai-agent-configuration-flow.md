# ADR-005: AI agent configuration order (provider → key → model) and single-source agent status

**Status:** Accepted
**Date:** 2026-08-19
**Deciders:** Project owner
**Relates to:** ADR-001 (workspace modules — `ai:manage` gating), ADR-004 (F7/F8 secret-handling discipline), `AGENTS.md` (channel/AI conventions; secrets AES-256-GCM at rest)

## Context

Two defects were reported against the AI Agents surface: **"getting the model
name seems like an issue"** during configuration, and **the Playground says the
agent is not set up when it is**. Both were reproduced and root-caused in the
tree. They are unrelated bugs that happen to share a screen.

### Defect 1 — the model list is structurally unable to load during setup

`src/app/api/ai/models/route.ts` lists models using **only the key already
stored on the account's default agent row**, and only when the stored provider
matches the requested one:

```ts
if (row?.api_key && row.provider === provider) apiKey = decrypt(row.api_key);
if (!apiKey && provider !== 'ollama')
  return NextResponse.json({ models: [], needsKey: true });
```

This is not an oversight — the route's own header documents it as a deliberate
trade-off:

> Uses the key ALREADY STORED on the account's default agent — no key is ever
> accepted in a query string (it would land in access logs). The consequence,
> deliberately: a provider the account has not saved a key for yet answers
> `needsKey: true` and the form falls back to free text, **which is also the
> first-run path.**

The security reasoning is correct and must be preserved. The consequence is
what shipped as a bug:

1. **First-run setup can never list models.** There is no agent row yet, so
   `agent-setup-wizard.tsx` renders a bare `<input type="text">` seeded from a
   hardcoded `PROVIDER_PRESETS` default. The operator must recall
   `gemini-2.5-flash` or `meta-llama/Llama-3.3-70B-Instruct-Turbo` from
   memory — precisely what `model-catalog.ts` says in its header it exists to
   prevent.
2. **Switching provider in Configuration empties the list.** Paste a fresh
   Google key over a saved OpenAI one and the list stays empty
   (`needsKey: true`) until after a save — but the save requires a model id
   that cannot be seen.
3. **The field order teaches the wrong sequence.** In both
   `agent-settings-form.tsx` and `admin-ai-agent.tsx` the **model field is
   rendered above the API key field**. The UI asks for the model before the
   key that is required to enumerate models.

A wrong-but-plausible model id is only caught at the provider on first real
use, so the failure surfaces as a broken auto-reply against a customer
conversation rather than as a validation error at configuration time.

### Defect 2 — the Playground's "not set up" banner (root cause)

`ai-playground.tsx` and `agents-console.tsx` call `useSWR` on the **same cache
key with two different fetchers**:

| File | Call | Shape returned |
| --- | --- | --- |
| `agents-console.tsx:71` | `useSWR('/api/ai/agents', swrJson)` | `{ agent, specialists }` |
| `ai-playground.tsx:60` | `useSWR('/api/ai/agents', fetchAgentStatus)` | `{ configured, autoReplyLive }` |

Both keys are the identical literal string `'/api/ai/agents'`. SWR keys its
cache by the key alone — **the fetcher is not part of the cache identity**. The
two hooks therefore share one cache entry. The console renders the Playground
as a tab, so the console's fetcher populates the entry first and the Playground
reads `{ agent, specialists }`, in which `configured` does not exist:

```ts
const isSetUp = Boolean(config?.configured); // undefined → always false
```

A fully configured agent renders **"Your agent isn't set up yet."**
`POST /api/ai/playground` itself is fine — it calls `loadAgentConfig` with
`requireEnabled: false`, so sending a message does return a reply. Only the
status banner lies, which is why the defect reads as cosmetic-but-confusing
rather than as a hard failure.

The underlying cause is that **"is this agent usable" is computed independently
in four places** and has already drifted. `agents-console.tsx:88` and `:477`
both use `Boolean(agent?.provider && agent?.model)` — omitting the
`hasApiKey` check that `ai-playground.tsx:38` includes — so an agent with a
provider and model but no key reads as "Paused" rather than "Not configured".

## Decision

1. **D1 — Configuration order is provider → key → model, everywhere.** The key
   is collected before the model on every surface, because the key is an input
   to enumerating models. This is the reported request, and it is validated by
   the code above.

2. **D2 — Key-first listing is a `POST` with the key in the JSON body.** Add
   `POST` beside the untouched `GET` on `/api/ai/models`, accepting
   `{ provider, api_key?, base_url? }`. `GET` (stored key) keeps its exact
   current behaviour, so every existing caller is unaffected.

   The key MUST NOT move to a query string. `model-catalog.ts` states the rule
   and it is correct: *"A key NEVER travels in a query string — URLs are the
   one part of a request that routinely lands in access logs, proxy logs and
   error reporters."* A body-carried key is the minimum change that unblocks
   first-run listing without weakening that rule. `api_key` absent falls back
   to the stored key exactly as `GET` does; the key is never persisted by this
   route, never logged, and never echoed in the response.

3. **D3 — Listing is the key verification; there is no separate verify call.**
   A provider that rejects the key answers `401`, which `listProviderModels`
   already maps to `code: 'invalid_key'`. Loading the list therefore verifies
   the key at zero additional cost, and the wizard gates on that code. Server-
   side verification in `POST /api/ai/agents` before storing is unchanged and
   remains the actual boundary — the client-side gate is a fast-fail for
   operator feedback, nothing more.

4. **D4 — The listing must never become a gate on configuration.**
   `model-catalog.ts` and `model-picker.tsx` both hold that the list is *a
   convenience, never a gate*, so the field stays typeable. Binding rule: the
   wizard blocks Continue **only on `code === 'invalid_key'`** — the provider
   actually rejected the key. `timeout`, `network_error`, `rate_limited`,
   `not_supported`, `bad_response` and `provider_error` show a warning and
   still allow Continue. Without this rule a provider outage, or a model
   released this morning, or a private deployment name, would make the product
   unconfigurable — a strictly worse failure than the one being fixed.

5. **D5 — Both configuration surfaces get key-first listing.** The tenant page
   (`/api/ai/models`, `requireRole('admin')`) and the super-admin console
   (`/api/admin/ai-models`, `requireSuperAdmin()` + explicit `account_id`)
   receive the same `POST`, so one shared `ModelPicker` serves both and the two
   cannot drift.

6. **D6 — The wizard becomes four steps:** Provider + Key → Model →
   Personality → Review. Step 1 collects provider, key and (for
   `custom`/`ollama`) base URL, and shows inline verification state. Step 2
   opens with the real model list fetched using the key just entered.

7. **D7 — A provider change clears the selected model.** A model id from the
   previous provider is never valid on the new one. Related: pre-select
   `PROVIDER_PRESETS.defaultModel` **only when that id is present in the
   returned list**; otherwise select nothing. Today's blind preset default is
   the mechanism by which a stale hardcoded id silently becomes a saved,
   dead model.

8. **D8 — Agent status has exactly one definition.** Introduce
   `isAgentConfigured(agent)` and `isAutoReplyLive(agent)` in
   `src/features/agents/lib/agent-meta.ts` (already the home of `ClientAgent`
   and `swrJson`, already imported by every consumer). Every surface derives
   status from these.

9. **D9 — The Playground reads the console's payload.** Delete
   `fetchAgentStatus` and the local `AgentStatus` interface; use
   `useSWR<{ agent: ClientAgent | null }>('/api/ai/agents', swrJson)` — the
   **same key and the same fetcher** as the console. The shared cache entry
   then becomes correct rather than accidental, and the tab costs no extra
   fetch. This is the Defect 2 fix.

10. **D10 — No database migration.** Nothing in the schema changes. Only *when*
    the key is available to the listing call, and *which* cache entry the
    Playground reads.

## Options considered

### Defect 1 — how to make the model list available before the first save

| Option | Complexity | Security | Verdict |
| --- | --- | --- | --- |
| **A. `GET /api/ai/models?api_key=…`** | Lowest | **Unacceptable** — key lands in access logs, proxy logs, error reporters; violates the module's stated rule | Rejected |
| **B. Save a draft agent row first, then list with the stored key** | Medium — needs a draft/incomplete row state, plus cleanup of abandoned wizards | Good | Rejected: introduces a half-configured row that RLS, `loadAgentConfig` and the console all have to learn to ignore. Large blast radius for a form-ordering problem. |
| **C. Ship a static model list per provider** | Lowest | Good | Rejected: goes stale on every provider release, and cannot know private/custom deployment names. `model-catalog.ts` exists precisely because static lists rot. |
| **D. `POST` with the key in the body (chosen)** | Low — one new verb, shared handler | Good — body is not logged by default; key not persisted | **Chosen.** Smallest change that fixes first-run listing while preserving the no-key-in-URL rule. |

### Defect 2 — how to fix the Playground banner

| Option | Verdict |
| --- | --- |
| **A. Give the Playground a distinct SWR key** (e.g. `'/api/ai/agents#status'`) | Rejected: fixes the symptom but adds a second network fetch of the same endpoint and leaves two definitions of "configured" to drift. |
| **B. Read the shared payload, derive status from shared helpers (chosen)** | **Chosen.** One fetch, one definition, and it simultaneously corrects the `agents-console.tsx:88`/`:477` drift. |

## Security review

Findings **F1–F6** are binding on the implementation.

- **F1 — The key must not leak into a URL, a log, or a client-side cache map
  (High).** D2 keeps it out of the query string. Two further rules: the route
  MUST NOT log the body or echo `api_key` in the response, and the client's SWR
  key MUST be a **fingerprint** (`${length}:${last4}`), never the raw key —
  otherwise the secret sits in SWR's in-memory cache map and in any devtools
  inspection of it. `listProviderModels` already keys its own process-local
  cache on a fingerprint (`cacheKey()`), so this matches existing discipline.
- **F2 — Authorization is unchanged and must stay explicit.** `POST` carries
  the same `requireRole('admin')` + `RATE_LIMITS.adminAction` as `GET` on the
  tenant route, and `requireSuperAdmin()` + a required `account_id` on the
  admin route. A new verb on an existing file is the classic place where a
  guard is forgotten; the two verbs share one handler body specifically so the
  guard cannot be present on one and absent on the other.
- **F3 — A caller-supplied key must not become an upstream amplifier.** The
  endpoint accepts an arbitrary key and calls a third party with it, so it is a
  potential outbound request amplifier. Mitigated by three existing
  mechanisms, all verified present in `model-catalog.ts`: a 10-minute positive
  cache, a **60-second negative cache** (`NEGATIVE_TTL_MS`) so a wrong key
  cannot be retried in a loop, and **in-flight coalescing**
  (`inFlight: Map<string, Promise<CatalogModel[]>>`) so concurrent identical
  requests share one upstream call. The client adds a **~600ms debounce** and
  ignores drafts under ~20 characters, so pasting a key spends one provider
  call rather than one per keystroke against a 30/min budget.
- **F4 — A rejected key must not be confusable with an unreachable provider.**
  D4 depends on this distinction being trustworthy: `invalid_key` blocks,
  everything else warns. The route keeps the existing non-throwing contract —
  `200 { models, needsKey, error?, code? }` — and the `code` is propagated
  from `AiError` unchanged rather than being re-derived in the UI.
- **F5 — The client-side check is not the boundary.** Per `AGENTS.md`, a
  disabled button is never the security boundary. `POST /api/ai/agents` still
  verifies the key server-side before encrypting and storing it, so a wizard
  gate bypassed by a crafted request changes nothing about what can be saved.
- **F6 — The rate-limit budget F2/F3 lean on is Redis-backed, with a
  bounded degradation mode.** Verified in `src/lib/rate-limit.ts`: when
  `KV_REST_API_URL`/`KV_REST_API_TOKEN` are present (Upstash), the 30/min
  `adminAction` budget is enforced **globally** across all serverless
  instances via atomic `INCR`. When Redis is unconfigured, errors, or the
  free-tier command quota is exhausted, a circuit breaker (60s cooldown)
  degrades enforcement to per-process in-memory — limits stay enforced per
  instance, requests never fail because the limiter's backend is down, and
  no unbounded Upstash spend is possible (the breaker stops calling Redis
  entirely while tripped). Under degradation, F3's amplification bound
  weakens from 30/min globally to 30/min **per instance**; this residual
  risk is accepted because (a) the endpoint requires an authenticated
  admin, (b) `model-catalog.ts`'s negative cache and in-flight coalescing
  bound upstream calls per process regardless of the limiter, and (c) at
  current scale (zero production tenants) the free tier is not approached.
  Decision on record: keep Upstash as the limiter backend; the cost
  concern at scale is answered by the breaker (fail-degraded, never
  fail-expensive), and revisit a paid tier only when real traffic exists.

Residual risk accepted: the in-progress key transits one additional
application request (the listing `POST`) before it is stored. This is the same
TLS-protected path the save request already uses, and the key is discarded
after the upstream call.

## Consequences

- **Easier:** first-run setup shows a real, provider-verified model list, so a
  typo cannot become a dead auto-reply discovered on a live customer thread.
  Switching provider now lists models immediately on paste, with no save.
  Agent status has one definition, so the console rail, the Playground and the
  inbox banner cannot disagree.
- **Harder:** `/api/ai/models` now has two verbs with different key sources —
  future edits must keep the shared handler shared, or the guard/contract drift
  F2 warns about becomes possible. `ModelPicker` gains a debounce, which means
  a test asserting an immediate fetch after typing must advance timers.
- **Fixed as a side effect:** the `agents-console.tsx:88`/`:477` status drift,
  which today mislabels a key-less agent as "Paused" instead of "Not
  configured".
- **Revisit:** specialist agents (`specialist-editor.tsx`) inherit the parent's
  provider and key and have no provider picker, so they need nothing beyond the
  D8 helpers. If specialists ever get their own credentials, D2–D7 apply to
  them unchanged.

## Action items

1. [ ] `POST` on `/api/ai/models` and `/api/admin/ai-models`, sharing one
       handler body with `GET` (D2, D5, F2)
2. [ ] `ModelPicker`: `draftApiKey` + `onListState`, ~600ms debounce,
       fingerprinted SWR key, `invalid_key` hint copy (D2, F1, F3)
3. [ ] Wizard → 4 steps with the `invalid_key`-only gate (D3, D4, D6, D7)
4. [ ] Reorder `agent-settings-form.tsx` and `admin-ai-agent.tsx` to
       key-above-model, passing `draftApiKey` (D1)
5. [ ] `isAgentConfigured` / `isAutoReplyLive` in `agent-meta.ts`; adopt in the
       Playground, console and inbox banner (D8, D9)
6. [ ] Tests: `POST` lists with no stored row; falls back to the stored key;
       a provider 401 answers `200 { code: 'invalid_key' }`; the key never
       appears in the response; helper unit tests including
       Ollama-needs-no-key
7. [ ] Record the two new verbs in `.agents/context/api-routes.md`, then
       `pnpm docs:sync` and `pnpm check`
