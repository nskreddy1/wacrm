# AI Settings Reliability Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix AI Settings loading and first-run behavior, expose all 12 supported providers, and support validated keyless Ollama configuration with an editable Base URL.

**Architecture:** Keep the existing SWR-backed settings component and API proof flow. Add a shared provider metadata registry for labels and capabilities, make the form render from that registry, and extend the existing tests first so the focused behavior is locked down without restructuring the AI engine architecture.

**Tech Stack:** Next.js 16, React 19, TypeScript, SWR, shadcn/ui, next-intl, Vitest, Supabase/Postgres.

## Global Constraints

- Provider selector exposes exactly the 12 values already supported by `AiProvider`.
- Ollama requires no user API key but changed settings require successful server connectivity validation before save.
- Base URL is editable for Ollama and Custom Endpoint; Ollama defaults to `http://localhost:11434`.
- A missing `ai_configs` row is a normal first-run state, not an error.
- Existing hosted-provider masked-key preservation remains unchanged.
- Do not change the unified-versus-separate AI engine architecture.
- Do not add a schema change unless live/local verification proves a required column is missing; if needed, add it through the repository migration and schema push workflow.
- Do not expose, log, or return provider secrets.

---

### Task 1: Provider Metadata and Settings UI

**Files:**
- Create: `src/lib/ai/providers.ts`
- Create: `src/lib/ai/providers.test.ts`
- Modify: `src/components/settings/ai-config.tsx`
- Modify: `messages/en.json`

**Interfaces:**
- Produces: `AI_PROVIDER_OPTIONS`, an ordered readonly list with `{ value: AiProvider; label: string; requiresApiKey: boolean; supportsBaseUrl: boolean }`.
- Produces: `getProviderCapabilities(provider: AiProvider)` for form behavior.
- Consumes: existing `AiProvider`, `DEFAULT_MODELS`, config/test API payloads, and shadcn controls.

- [ ] **Step 1: Write failing provider-registry tests**

Create `src/lib/ai/providers.test.ts` with tests asserting the exact ordered 12 provider values, Ollama `requiresApiKey: false`, and Ollama/Custom `supportsBaseUrl: true`.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `pnpm test src/lib/ai/providers.test.ts`

Expected: FAIL because `src/lib/ai/providers.ts` does not exist.

- [ ] **Step 3: Implement the provider registry**

Create `src/lib/ai/providers.ts` using the existing `AiProvider` union. Define all 12 labels and capabilities in one readonly registry and export a lookup helper that throws for unsupported values rather than silently inventing defaults.

- [ ] **Step 4: Run provider tests and verify GREEN**

Run: `pnpm test src/lib/ai/providers.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing component behavior coverage through testable state helpers**

Extract only the pure form-state decisions needed by the component into the provider module or a focused sibling helper, then add tests that assert:

- Ollama initializes `baseUrl` to `http://localhost:11434` when no saved URL exists.
- Switching to a provider without Base URL support clears the submitted URL.
- Ollama test/save payload construction does not require a browser-provided API key.
- Provider/model/key/Base URL changes invalidate successful test state.

Run the focused test and confirm the new assertions fail for missing behavior.

- [ ] **Step 6: Update the AI Settings component minimally**

Modify `src/components/settings/ai-config.tsx` to:

- render provider options from `AI_PROVIDER_OPTIONS` inside the existing Select group;
- render a shadcn `Skeleton` loading card while SWR has neither data nor error;
- retain the load-failure alert only for an actual SWR error;
- treat `{ configured: false }` as the normal default editable form;
- show Base URL for Ollama and Custom Endpoint;
- hide the API-key input for Ollama and show localized keyless guidance;
- label the action “Test connection” for Ollama and retain “Test key” for hosted providers;
- include `base_url` in test/save requests;
- invalidate prior success when provider, model, credential, or Base URL changes;
- disable save until the existing proof contract is satisfied for changed settings.

Use existing shadcn components and semantic design tokens; do not redesign the card.

- [ ] **Step 7: Add English translations**

Modify `messages/en.json` under the existing AI configuration namespace with explicit strings for loading, Base URL label/description, Ollama keyless guidance, and Test connection. Do not add a new locale because English is the repository’s only message file.

- [ ] **Step 8: Run focused tests, typecheck, and lint changed files**

Run:

```bash
pnpm test src/lib/ai/providers.test.ts src/lib/ai/config.test.ts src/lib/ai/engines/langchain/model.test.ts
pnpm typecheck
pnpm exec eslint src/components/settings/ai-config.tsx src/lib/ai/providers.ts src/lib/ai/providers.test.ts
```

Expected: all focused tests pass, typecheck exits 0, and ESLint reports no errors.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/lib/ai/providers.ts src/lib/ai/providers.test.ts src/components/settings/ai-config.tsx messages/en.json
git commit -m "fix: complete AI provider settings UI"
```

---

### Task 2: Keyless Ollama API Proof Regression Coverage

**Files:**
- Create: `src/app/api/ai/test/route.test.ts` only if route-level mocking is practical with the existing Vitest setup; otherwise extend `src/lib/ai/config.test.ts` around the shared proof/config functions.
- Modify: `src/app/api/ai/test/route.ts` only if the failing test proves a mismatch.
- Modify: `src/app/api/ai/config/route.ts` only if the failing test proves a mismatch.
- Modify: `src/lib/ai/config.ts` only if the failing test proves a mismatch.

**Interfaces:**
- Consumes: existing `/api/ai/test` payload `{ provider, model, api_key?, base_url? }` and returned proof.
- Consumes: existing `/api/ai/config` save proof validation.
- Produces: regression coverage showing Ollama can validate without a user key and cannot bypass connectivity proof.

- [ ] **Step 1: Write a failing keyless Ollama regression test**

Test the narrowest existing server boundary and assert:

- Ollama validation accepts an omitted user API key and forwards the selected Base URL to the engine/config path.
- Successful validation returns proof bound to provider/model/Base URL.
- Saving changed Ollama settings without matching proof is rejected.
- Saving with matching proof succeeds while persisting the backend-managed keyless placeholder, not a browser secret.

Confirm the test fails for the exact missing behavior, not because of mock setup.

- [ ] **Step 2: Run the regression test and verify RED**

If route-level coverage is added, run `pnpm test src/app/api/ai/test/route.test.ts`; if the existing config test is extended, run `pnpm test src/lib/ai/config.test.ts`.

Expected: FAIL on a keyless Ollama or Base URL assertion. If all assertions already pass, retain the regression test and make no production API change.

- [ ] **Step 3: Apply the smallest server fix if required**

Change only the failing boundary. Preserve hosted-provider key requirements, sanitized errors, test-proof matching, masked-key preservation, and the existing database representation. Do not add a migration because `provider` and `base_url` already exist in migration `045_ai_provider_expansion.sql` and the verified schema.

- [ ] **Step 4: Run server and focused AI tests**

Run:

```bash
pnpm test src/lib/ai/config.test.ts src/lib/ai/providers.test.ts src/lib/ai/engines/langchain/model.test.ts
pnpm typecheck
```

If `src/app/api/ai/test/route.test.ts` was created, also run `pnpm test src/app/api/ai/test/route.test.ts`. Expected: PASS. Do not include the unrelated generation tests that currently attempt external provider calls.

- [ ] **Step 5: Verify the UI in the browser**

Use the `agent-browser` skill with viewport `1208x457` and dark color scheme. Verify loading/first-run presentation, open the provider selector and confirm all 12 choices, select Ollama, confirm Base URL and keyless guidance, and confirm the test/save controls use connection language without layout overflow.

- [ ] **Step 6: Review schema workflow and commit Task 2**

Confirm no schema file changed. If verification unexpectedly requires a schema change, add a new imperative migration through the repository’s Supabase workflow and ensure `scripts/push-supabase-schema.mjs` includes it.

```bash
git add src/app/api/ai/test/route.test.ts src/app/api/ai/test/route.ts src/app/api/ai/config/route.ts src/lib/ai/config.ts
git commit -m "test: cover keyless Ollama configuration"
```

Stage only files that actually changed.

---

### Task 3: Final Verification and Review

**Files:**
- Modify only files required to resolve verified Critical or Important review findings.

**Interfaces:**
- Consumes: completed Task 1 and Task 2 commits.
- Produces: reviewed branch with focused tests, typecheck, lint, and browser path verified.

- [ ] **Step 1: Run final focused verification**

```bash
pnpm test src/lib/ai/providers.test.ts src/lib/ai/config.test.ts src/lib/ai/engines/langchain/model.test.ts
pnpm typecheck
pnpm exec eslint src/components/settings/ai-config.tsx src/lib/ai/providers.ts src/lib/ai/providers.test.ts
```

Include a route test path if Task 2 created one. Expected: all commands exit 0.

- [ ] **Step 2: Inspect the complete branch diff**

Run `git diff main...HEAD --check` and inspect `git diff main...HEAD --stat`. Expected: no whitespace errors and only focused AI settings/spec/plan files.

- [ ] **Step 3: Request final code review**

Review against `docs/superpowers/specs/2026-07-17-ai-settings-fix-design.md`. Fix all Critical and Important findings, rerun the covering tests, and re-review until clean.

- [ ] **Step 4: Record final verification commit if fixes were needed**

Stage each file changed for verified review fixes with `git add`, then run:

```bash
git commit -m "fix: address AI settings review findings"
```

Do not create an empty commit.
